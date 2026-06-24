using System.Collections.Generic;
using System.Globalization;
using System.Speech.Recognition;

namespace VoiceHelper
{
    // ─────────────────────────────────────────────────────────────────────────────
    // Builds a bounded SAPI grammar from a pushed {t:"grammar"} message.
    //
    // Grammar shape:   (optional "camera" one|two)  THEN  a verb pattern
    //
    // We never string-parse the recognized text. Every meaningful token is tagged with a
    // SemanticResultKey, so e.Result.Semantics yields a structured tree:
    //
    //   Semantics["camera"]  → int 1|2          (present only if a prefix was spoken)
    //   Semantics["verb"]    → string verb id   (always present)
    //   Semantics["target"]  → int | string     (recall / bare-label)
    //   Semantics["from"]    → int | string     (sweep)
    //   Semantics["to"]      → int | string     (sweep)
    //
    // Number tokens: spoken as the English word ("three") but the SEMANTIC VALUE is the int 3.
    // Label tokens:  spoken as the lowercased label words, semantic value is the label string.
    // ─────────────────────────────────────────────────────────────────────────────

    internal static class SemanticKeys
    {
        public const string Camera = "camera";
        public const string Verb = "verb";
        public const string Target = "target";
        public const string From = "from";
        public const string To = "to";
    }

    internal static class GrammarFactory
    {
        // English number words 1..30 for spoken number tokens. Index == value.
        private static readonly string[] NumberWords =
        {
            "zero", // 0 placeholder, never used as a shot
            "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
            "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
            "eighteen", "nineteen", "twenty", "twenty one", "twenty two", "twenty three",
            "twenty four", "twenty five", "twenty six", "twenty seven", "twenty eight",
            "twenty nine", "thirty",
        };

        /// <summary>
        /// Build the full grammar from the pushed verbs + per-camera shot token map.
        /// Shots are deduped into a single union of target tokens used for recall/sweep.
        /// If shots are empty, the recall/sweep branches are simply omitted so the
        /// motion verbs still work.
        /// </summary>
        public static Grammar Build(List<VerbSpec> verbs, Dictionary<string, List<string>> shots)
        {
            // 1. Union + dedupe target tokens across both cameras.
            var targetTokens = new List<string>();
            var seen = new HashSet<string>(System.StringComparer.OrdinalIgnoreCase);
            if (shots != null)
            {
                foreach (var list in shots.Values)
                {
                    if (list == null) continue;
                    foreach (var tok in list)
                    {
                        if (string.IsNullOrEmpty(tok) || tok.Trim().Length == 0) continue;
                        var t = tok.Trim();
                        if (seen.Add(t)) targetTokens.Add(t);
                    }
                }
            }

            // 2. Optional "camera one|two" prefix → an OPTIONAL Choices.
            //    Implemented as a Choices that contains an empty GrammarBuilder alternative
            //    (the "no prefix spoken" branch) plus the camera-N branch.
            var cameraPrefix = BuildOptionalCameraPrefix();

            // 3. The verb body is a Choices over every supported verb pattern.
            var verbBody = BuildVerbBody(verbs, targetTokens);

            // 4. Full utterance = optional prefix + verb body.
            var utterance = new GrammarBuilder();
            utterance.Append(cameraPrefix);
            utterance.Append(verbBody);

            var grammar = new Grammar(utterance);
            grammar.Name = "voice-ptz";
            return grammar;
        }

        /// <summary>
        /// Optional camera prefix. The empty alternative makes the whole prefix optional
        /// without relying on AppendRepeat(0,1) (which doesn't carry semantics cleanly).
        /// </summary>
        private static GrammarBuilder BuildOptionalCameraPrefix()
        {
            // Branch A: nothing spoken (empty builder) → no "camera" semantic emitted.
            var empty = new GrammarBuilder();

            // Branch B: "camera" + (one|two), tagging the number as int 1|2 under "camera".
            var camNum = new Choices();
            camNum.Add(new SemanticResultValue("one", 1));
            camNum.Add(new SemanticResultValue("two", 2));

            var spoken = new GrammarBuilder();
            spoken.Append("camera");
            spoken.Append(new SemanticResultKey(SemanticKeys.Camera, camNum));

            return new GrammarBuilder(new Choices(empty, spoken));
        }

        /// <summary>
        /// The verb body: one Choices alternative per verb pattern. Each alternative tags
        /// the "verb" semantic with the verb id, plus target/from/to where relevant.
        /// </summary>
        private static GrammarBuilder BuildVerbBody(List<VerbSpec> verbs, List<string> targetTokens)
        {
            var alternatives = new List<GrammarBuilder>();

            // Index verbs by id so we honour the phrases BB actually pushed.
            var byId = new Dictionary<string, VerbSpec>(System.StringComparer.OrdinalIgnoreCase);
            foreach (var v in verbs)
            {
                if (v == null || string.IsNullOrEmpty(v.Id) || v.Id.Trim().Length == 0) continue;
                byId[v.Id] = v;
            }

            // Pre-build the shared <target> Choices (numbers as ints, labels as strings).
            // Null when there are no shots — recall/sweep then get skipped.
            var targetChoices = BuildTargetChoices(targetTokens);

            // ── select: "camera one"/"camera two" ALONE → {verb:"select", camera:N} ──
            // Special case: no leading "camera" prefix here. The phrase itself is the camera.
            // We emit verb=select and a camera semantic from the same utterance.
            if (byId.ContainsKey("select"))
            {
                var camNum = new Choices();
                camNum.Add(new SemanticResultValue("camera one", 1));
                camNum.Add(new SemanticResultValue("camera two", 2));

                var selectAlt = new GrammarBuilder();
                selectAlt.Append(new SemanticResultKey(SemanticKeys.Verb, new SemanticResultValue("select")));
                selectAlt.Append(new SemanticResultKey(SemanticKeys.Camera, camNum));
                alternatives.Add(selectAlt);
            }

            // ── recall: ("shot"|"go to shot") + <target>  AND  bare <label> → {verb:"recall", target} ──
            if (byId.ContainsKey("recall") && targetChoices != null)
            {
                // "shot three" / "go to shot three" / "shot drummer"
                var lead = new Choices("shot", "go to shot");
                var recallPhrase = new GrammarBuilder();
                recallPhrase.Append(new SemanticResultKey(SemanticKeys.Verb, new SemanticResultValue("recall")));
                recallPhrase.Append(lead);
                recallPhrase.Append(new SemanticResultKey(SemanticKeys.Target, targetChoices));
                alternatives.Add(recallPhrase);

                // Bare non-numeric label → recall. Only labels (not number words) may be bare,
                // so a stray "three" doesn't fire a recall on its own.
                var labelChoices = BuildLabelOnlyChoices(targetTokens);
                if (labelChoices != null)
                {
                    var bareLabel = new GrammarBuilder();
                    bareLabel.Append(new SemanticResultKey(SemanticKeys.Verb, new SemanticResultValue("recall")));
                    bareLabel.Append(new SemanticResultKey(SemanticKeys.Target, labelChoices));
                    alternatives.Add(bareLabel);
                }
            }

            // ── motion verbs: phrase(s) → {verb:id} (camera handled by the optional prefix) ──
            // pushIn, slowPushIn, pullOut, zoomIn, wide, track, stop
            string[] motionVerbs = { "pushIn", "slowPushIn", "pullOut", "zoomIn", "wide", "track", "stop" };
            foreach (var id in motionVerbs)
            {
                VerbSpec spec;
                if (!byId.TryGetValue(id, out spec)) continue;
                var phraseChoices = ToChoices(spec.Phrases);
                if (phraseChoices == null) continue;

                var alt = new GrammarBuilder();
                alt.Append(new SemanticResultKey(SemanticKeys.Verb, new SemanticResultValue(id)));
                // The phrase words are recognized but carry no extra semantic of their own.
                alt.Append(phraseChoices);
                alternatives.Add(alt);
            }

            // ── sweep: "sweep" + <target> + "to" + <target> → {verb:"sweep", from, to} ──
            if (byId.ContainsKey("sweep") && targetChoices != null)
            {
                var spec = byId["sweep"];
                // Use pushed phrases for the lead word(s); fall back to "sweep".
                var lead = ToChoices(spec.Phrases);
                if (lead == null) lead = new Choices("sweep");

                var sweepPhrase = new GrammarBuilder();
                sweepPhrase.Append(new SemanticResultKey(SemanticKeys.Verb, new SemanticResultValue("sweep")));
                sweepPhrase.Append(lead);
                sweepPhrase.Append(new SemanticResultKey(SemanticKeys.From, targetChoices));
                sweepPhrase.Append("to");
                sweepPhrase.Append(new SemanticResultKey(SemanticKeys.To, targetChoices));
                alternatives.Add(sweepPhrase);
            }

            // Defensive: a grammar with no alternatives is invalid. Add an unmatchable
            // placeholder so Build() never throws on a totally empty verb set.
            if (alternatives.Count == 0)
            {
                var noop = new GrammarBuilder();
                noop.Append(new SemanticResultKey(SemanticKeys.Verb, new SemanticResultValue("__noop__")));
                noop.Append("system reserved no operation");
                alternatives.Add(noop);
            }

            return new GrammarBuilder(new Choices(alternatives.ToArray()));
        }

        /// <summary>
        /// Build the &lt;target&gt; Choices over all tokens: number strings become spoken
        /// number-words with an int semantic; labels become spoken label-words with a string
        /// semantic. Returns null if there are no tokens.
        /// </summary>
        private static Choices BuildTargetChoices(List<string> tokens)
        {
            if (tokens.Count == 0) return null;
            var choices = new Choices();
            var added = 0;
            foreach (var tok in tokens)
            {
                int n;
                if (IsNumber(tok, out n))
                {
                    if (n < 1 || n >= NumberWords.Length) continue; // out of 1..30 map range
                    // spoken "three"  →  semantic int 3
                    choices.Add(new SemanticResultValue(NumberWords[n], n));
                    added++;
                }
                else
                {
                    var spoken = tok.ToLowerInvariant();
                    // spoken label words  →  semantic string (original label)
                    choices.Add(new SemanticResultValue(spoken, tok));
                    added++;
                }
            }
            return added > 0 ? choices : null;
        }

        /// <summary>Label-only Choices (no number tokens) for the bare-label recall branch.</summary>
        private static Choices BuildLabelOnlyChoices(List<string> tokens)
        {
            var choices = new Choices();
            var added = 0;
            foreach (var tok in tokens)
            {
                int dummy;
                if (IsNumber(tok, out dummy)) continue; // numbers must say "shot N", never bare
                choices.Add(new SemanticResultValue(tok.ToLowerInvariant(), tok));
                added++;
            }
            return added > 0 ? choices : null;
        }

        /// <summary>Turn a phrase list into a Choices (each phrase a literal alternative).</summary>
        private static Choices ToChoices(List<string> phrases)
        {
            if (phrases == null) return null;
            var clean = new List<string>();
            foreach (var p in phrases)
            {
                if (string.IsNullOrEmpty(p) || p.Trim().Length == 0) continue;
                clean.Add(p.Trim().ToLowerInvariant());
            }
            if (clean.Count == 0) return null;
            return new Choices(clean.ToArray());
        }

        private static bool IsNumber(string tok, out int n)
        {
            return int.TryParse(tok, NumberStyles.Integer, CultureInfo.InvariantCulture, out n);
        }
    }
}
