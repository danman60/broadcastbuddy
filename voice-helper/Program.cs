using System;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Recognition;
using System.Threading;

namespace VoiceHelper
{
    // ─────────────────────────────────────────────────────────────────────────────
    // voice-helper.exe — offline SAPI speech recognition for BroadcastBuddy.
    //
    // Talks NDJSON over stdio:  stdin = BB→helper, stdout = helper→BB (flushed every write).
    //
    // Lifecycle:
    //   1. Construct SpeechRecognitionEngine (try/catch → {t:error,reason:"no-recognizer"},
    //      but KEEP the stdin loop alive so BB's auto-relaunch doesn't thrash).
    //   2. Emit {t:"ready"} once after the engine is constructed (BEFORE any grammar).
    //   3. BB pushes {t:"grammar"}; we (re)load the bounded grammar.
    //   4. {t:"listen",on:true}  → RecognizeAsync(Multiple); accumulate best result.
    //      {t:"listen",on:false} → stop; emit best as {t:"result"} or {t:"reject"}.
    //
    // net48 build (in-box Roslyn csc / VS BuildTools MSBuild). No System.Text.Json:
    // JSON goes through System.Web.Script.Serialization.JavaScriptSerializer (see Protocol.cs).
    // ─────────────────────────────────────────────────────────────────────────────

    internal sealed class Program
    {
        private readonly object _gate = new object();   // guards _best + listening state
        private SpeechRecognitionEngine _engine;
        private RecognitionResult _best;                 // highest-confidence result during a hold
        private bool _listening;
        private bool _continuous;                        // hands-free wake mode: emit per recognition, no key-up
        private MicStream _mic;                          // picker-chosen device; null = Windows default
        private int _peakLevel = -1;                     // max SAPI audio level (0-100) during a hold; -1 = no level event (fires on the default device only)
        private Timer _meterTimer;
        private MicStream _meterMic;                     // default input capture, opened ONLY for metering
        private bool _meterEnabled;

        private static int Main()
        {
            return new Program().Run();
        }

        private int Run()
        {
            TryBuildEngine();

            // Always announce readiness so BB knows the process is up and will push grammar.
            // If the engine failed, we already emitted {t:error}; "ready" still lets BB push
            // grammar (which will no-op) and keeps the relaunch loop calm.
            Emit(Outbound.Ready());

            // ── stdin dispatch loop. Never crash on a malformed line. ──
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (string.IsNullOrEmpty(line) || line.Trim().Length == 0) continue;

                Dictionary<string, object> raw;
                try
                {
                    raw = Json.ParseObject(line);
                }
                catch
                {
                    // Malformed JSON → ignore the line, stay alive.
                    continue;
                }
                if (raw == null) continue;

                InboundMessage msg = InboundMessage.From(raw);
                if (msg.T == null) continue;

                try
                {
                    Dispatch(msg);
                }
                catch (Exception ex)
                {
                    // Any per-message failure is reported, never fatal.
                    Emit(Outbound.Error("dispatch-fail: " + ex.GetType().Name));
                }
            }

            // stdin closed → BB exited. Tear down cleanly.
            Shutdown();
            return 0;
        }

        // ── engine construction ──────────────────────────────────────────────────

        private void TryBuildEngine()
        {
            try
            {
                var engine = new SpeechRecognitionEngine();   // default (system) recognizer
                engine.SetInputToDefaultAudioDevice();        // v1: Windows default input device

                engine.SpeechRecognized += OnRecognized;
                engine.SpeechRecognitionRejected += OnRejected;
                engine.RecognizeCompleted += (s, e) => { if (e.Error != null) Emit(Outbound.Error("recognize-fail: " + e.Error.GetType().Name + ": " + e.Error.Message)); };
                engine.AudioLevelUpdated += (s, e) => { if (e.AudioLevel > _peakLevel) _peakLevel = e.AudioLevel; };

                _engine = engine;
            }
            catch (Exception ex)
            {
                // No recognizer installed / engine failed to init. Report and keep running.
                _engine = null;
                string reason = (ex is InvalidOperationException) ? "no-recognizer" : "engine-fail";
                Emit(Outbound.Error(reason));
            }
        }

        // ── inbound dispatch ───────────────────────────────────────────────────────

        private void Dispatch(InboundMessage msg)
        {
            switch (msg.T)
            {
                case "grammar":
                    LoadGrammar(msg);
                    break;

                case "listen":
                    // PTT path. Inert while continuous (hands-free) recognition owns the engine.
                    if (_continuous) break;
                    if (msg.On == true) StartListening();
                    else StopListeningAndEmit();
                    break;

                case "wake":
                    // Hands-free continuous recognition gated by the wake-word grammar prefix.
                    if (msg.On == true) StartContinuous();
                    else StopContinuous();
                    break;

                case "mic":
                    SelectMic(msg.DeviceId);
                    break;

                case "ping":
                    Emit(Outbound.Pong());
                    break;

                case "meter":
                    SetMeter(msg.On == true);
                    break;

                case "file":
                    // Test hook: recognize a WAV once against the live grammar so the real
                    // SAPI path can be verified without a mic. Emits result/reject like PTT.
                    RecognizeFile(msg.Path);
                    break;

                default:
                    // Unknown message type → ignore silently.
                    break;
            }
        }

        // deviceId = the picker's device label ("" = Windows default). Unknown label → default + error.
        private void SelectMic(string label)
        {
            if (_engine == null) return;
            bool resumeMeter = _meterEnabled;
            SetMeter(false);
            bool resumeContinuous;
            lock (_gate)
            {
                resumeContinuous = _continuous;
                if (_listening) { try { _engine.RecognizeAsyncCancel(); } catch { } _listening = false; _best = null; }
            }
            MicStream next = null;
            string err = null;
            if (!string.IsNullOrEmpty(label))
            {
                try { next = MicStream.Open(label); if (next == null) err = "mic-not-found: " + label + " (have: " + string.Join(" | ", MicStream.DeviceNames()) + ")"; }
                catch (Exception ex) { err = "mic-open-fail: " + ex.Message; }
            }
            MicStream old = _mic;
            _mic = next;
            SetEngineInput();
            if (old != null) old.Dispose();
            if (err != null) Emit(Outbound.Error(err));
            Emit(new Dictionary<string, object> { { "t", "mic" }, { "name", next != null ? next.Name : "" } });
            if (resumeContinuous) StartContinuous();
            if (resumeMeter) SetMeter(true);
        }

        // Independent 200 ms sample window. Reading it never consumes audio or changes
        // grammar/listening state, and never resets MicStream.Peak (PTT silent-mic check).
        private void SetMeter(bool on)
        {
            lock (_gate)
            {
                _meterEnabled = false;
                if (_meterTimer != null) { _meterTimer.Dispose(); _meterTimer = null; }
                if (_meterMic != null) { _meterMic.Dispose(); _meterMic = null; }
                if (!on) return;
                try
                {
                    if (_mic == null) _meterMic = MicStream.OpenDefault();
                    (_mic ?? _meterMic).TakeMeterPeak();
                    _meterEnabled = true;
                    _meterTimer = new Timer(_ =>
                    {
                        lock (_gate)
                        {
                            if (!_meterEnabled) return;
                            int peak = (_mic ?? _meterMic).TakeMeterPeak();
                            int percent = Math.Min(100, Math.Max(0, (int)Math.Round(peak * 100.0 / 32768.0)));
                            Emit(new Dictionary<string, object> { { "t", "level" }, { "peak", percent } });
                        }
                    }, null, 200, 200);
                }
                catch (Exception ex) { Emit(Outbound.Error("meter-unavailable: " + ex.Message)); }
            }
        }

        private void SetEngineInput()
        {
            if (_mic != null)
                _engine.SetInputToAudioStream(_mic, new System.Speech.AudioFormat.SpeechAudioFormatInfo(
                    MicStream.Rate, System.Speech.AudioFormat.AudioBitsPerSample.Sixteen, System.Speech.AudioFormat.AudioChannel.Mono));
            else
                _engine.SetInputToDefaultAudioDevice();
        }

        private void LoadGrammar(InboundMessage msg)
        {
            if (_engine == null) return; // no engine → nothing to load; BB still got {t:ready}

            Grammar grammar;
            try
            {
                grammar = GrammarFactory.Build(msg.Verbs ?? new List<VerbSpec>(), msg.Shots, msg.WakeWord);
            }
            catch (Exception ex)
            {
                Emit(Outbound.Error("grammar-build-fail: " + ex.GetType().Name + ": " + ex.Message + " @ " + ex.StackTrace));
                return;
            }

            bool resumeContinuous;
            try
            {
                // Unload prior grammar, load the new one. Must not be mid-recognition.
                lock (_gate)
                {
                    resumeContinuous = _continuous;
                    if (_listening)
                    {
                        _engine.RecognizeAsyncCancel();
                        _listening = false;
                        _best = null;
                    }
                    _engine.UnloadAllGrammars();
                    _engine.LoadGrammar(grammar);
                }
            }
            catch (Exception ex)
            {
                Emit(Outbound.Error("grammar-load-fail: " + ex.GetType().Name));
                return;
            }

            // A grammar reload cancels any in-flight recognition; if we were running
            // hands-free, resume continuous recognition against the new grammar.
            if (resumeContinuous) StartContinuous();
        }

        // ── PTT capture model ──────────────────────────────────────────────────────

        private void StartListening()
        {
            if (_engine == null) return;
            lock (_gate)
            {
                if (_listening) return;        // already capturing this hold
                _best = null;                  // fresh hold
                _listening = true;
                _peakLevel = -1;
            }
            if (_mic != null) _mic.Discard();
            try
            {
                // Multiple = keep recognizing repeatedly until we cancel on key-up.
                _engine.RecognizeAsync(RecognizeMode.Multiple);
            }
            catch (Exception ex)
            {
                lock (_gate) { _listening = false; }
                Emit(Outbound.Error("listen-start-fail: " + ex.GetType().Name));
            }
        }

        private void StopListeningAndEmit()
        {
            if (_engine == null)
            {
                // No engine: a key-up with nothing to capture → reject so BB plays its tone.
                Emit(Outbound.Reject("no-recognizer", 0f));
                return;
            }

            RecognitionResult best;
            lock (_gate)
            {
                if (!_listening)
                {
                    // Spurious key-up; emit a reject so BB has a deterministic outcome.
                    Emit(Outbound.Reject("not-listening", 0f));
                    return;
                }
                _listening = false;
                best = _best;
                _best = null;
            }

            // Stop the async recognizer (cancel discards buffered audio that hasn't fired yet,
            // which is what we want on key-up — we only act on what was already recognized).
            try { _engine.RecognizeAsyncCancel(); }
            catch { /* engine may already be idle */ }

            if (best == null)
            {
                // Nothing above the floor all hold → the mic delivered silence (dead/muted/virtual device).
                // Picked device: own sample peak (< -60 dBFS). Default device: SAPI level events, if any fired.
                bool silent = _mic != null ? _mic.Peak < 33 : (_peakLevel >= 0 && _peakLevel < 2);
                Emit(Outbound.Reject(silent ? "mic-silent" : "no-match", 0f));
                return;
            }

            Emit(BuildResult(best));
        }

        private void RecognizeFile(string path)
        {
            if (_engine == null) { Emit(Outbound.Reject("no-recognizer", 0f)); return; }
            lock (_gate)
            {
                if (_listening) { Emit(Outbound.Error("file-busy")); return; }
            }
            try
            {
                _engine.SetInputToWaveFile(path);
                RecognitionResult r = _engine.Recognize();
                if (r == null) Emit(Outbound.Reject("no-match", 0f));
                else Emit(BuildResult(r));
            }
            catch (Exception ex)
            {
                Emit(Outbound.Error("file-fail: " + ex.GetType().Name));
            }
            finally
            {
                try { SetEngineInput(); } catch { /* no mic on this box */ }
            }
        }

        // ── hands-free (continuous wake-word) capture model ─────────────────────────

        private void StartContinuous()
        {
            if (_engine == null) return;
            lock (_gate)
            {
                if (_continuous && _listening) return; // already running hands-free
                _continuous = true;
                _listening = true;
                _best = null;
            }
            try
            {
                _engine.RecognizeAsync(RecognizeMode.Multiple);
            }
            catch (Exception ex)
            {
                lock (_gate) { _continuous = false; _listening = false; }
                Emit(Outbound.Error("wake-start-fail: " + ex.GetType().Name));
            }
        }

        private void StopContinuous()
        {
            lock (_gate)
            {
                _continuous = false;
                _listening = false;
                _best = null;
            }
            try { _engine.RecognizeAsyncCancel(); }
            catch { /* engine may already be idle */ }
        }

        // ── recognition handlers ───────────────────────────────────────────────────

        private void OnRecognized(object sender, SpeechRecognizedEventArgs e)
        {
            RecognitionResult r = e.Result;
            if (r == null) return;
            bool emitNow = false;
            lock (_gate)
            {
                if (!_listening) return; // ignore late events after key-up / stop
                if (_continuous)
                {
                    // Hands-free: every full "<wake> <command>" match fires immediately
                    // (there is no key-up to flush a best result on).
                    emitNow = true;
                }
                else
                {
                    // PTT: keep the highest-confidence result seen during the hold.
                    if (_best == null || r.Confidence > _best.Confidence)
                        _best = r;
                }
            }
            if (emitNow) Emit(BuildResult(r)); // Emit takes _gate — must be outside the lock above
        }

        private void OnRejected(object sender, SpeechRecognitionRejectedEventArgs e)
        {
            // Rejected = below the engine's own confidence/grammar match. Do NOT store it;
            // the final reject (if no good result lands) is emitted on key-up.
        }

        // ── semantics → result fields ──────────────────────────────────────────────

        private static Dictionary<string, object> BuildResult(RecognitionResult r)
        {
            SemanticValue sem = r.Semantics;

            int? camera = null;
            string verb = "";
            object target = null;
            object from = null;
            object to = null;

            // verb — always present in a well-formed match.
            if (sem.ContainsKey(SemanticKeys.Verb))
            {
                object vv = sem[SemanticKeys.Verb].Value;
                verb = vv != null ? vv.ToString() : "";
            }

            // camera — int 1|2 when a prefix (or "camera one/two" select) was spoken; else null.
            if (sem.ContainsKey(SemanticKeys.Camera))
                camera = AsInt(sem[SemanticKeys.Camera].Value);

            // target/from/to — int (shot number) or string (label). Emit raw value so BB sees
            // 3 (number) or "drummer" (string) exactly as the grammar produced it.
            if (sem.ContainsKey(SemanticKeys.Target))
                target = sem[SemanticKeys.Target].Value;
            if (sem.ContainsKey(SemanticKeys.From))
                from = sem[SemanticKeys.From].Value;
            if (sem.ContainsKey(SemanticKeys.To))
                to = sem[SemanticKeys.To].Value;

            return Outbound.Result(camera, verb, target, from, to, r.Confidence);
        }

        private static int? AsInt(object v)
        {
            if (v is int) return (int)v;
            int p;
            if (v != null && int.TryParse(v.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out p))
                return p;
            return null;
        }

        // ── output ─────────────────────────────────────────────────────────────────

        private void Emit(Dictionary<string, object> msg)
        {
            // One object per line. Flush so BB sees it immediately.
            lock (_gate)
            {
                string json = Json.Serialize(msg);
                Console.Out.Write(json);
                Console.Out.Write('\n');
                Console.Out.Flush();
            }
        }

        private void Shutdown()
        {
            SetMeter(false);
            try
            {
                if (_engine != null)
                {
                    try { _engine.RecognizeAsyncCancel(); } catch { }
                    _engine.Dispose();
                    _engine = null;
                }
                if (_mic != null) { _mic.Dispose(); _mic = null; }
            }
            catch { /* best-effort */ }
        }
    }
}
