using System;
using System.Collections.Generic;
using System.Globalization;
using System.Speech.Recognition;

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
                    // v1: System.Speech only supports the Windows default device. Accept + log,
                    // do NOT fail. Device selection is a BB-side preference for a future version.
                    Emit(Outbound.Error("mic-default-only: deviceId noted, using Windows default"));
                    break;

                case "ping":
                    Emit(Outbound.Pong());
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
            }
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
                Emit(Outbound.Reject("no-match", 0f));
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
                try { _engine.SetInputToDefaultAudioDevice(); } catch { /* no mic on this box */ }
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
            string json = Json.Serialize(msg);
            // One object per line. Flush so BB sees it immediately.
            lock (_gate)
            {
                Console.Out.Write(json);
                Console.Out.Write('\n');
                Console.Out.Flush();
            }
        }

        private void Shutdown()
        {
            try
            {
                if (_engine != null)
                {
                    try { _engine.RecognizeAsyncCancel(); } catch { }
                    _engine.Dispose();
                    _engine = null;
                }
            }
            catch { /* best-effort */ }
        }
    }
}
