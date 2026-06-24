using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Web.Script.Serialization;

namespace VoiceHelper
{
    // ─────────────────────────────────────────────────────────────────────────────
    // Wire protocol — NDJSON, one object per line.
    //   stdin  = BB → helper
    //   stdout = helper → BB   (flush after every write)
    // All messages carry a "t" discriminator.
    //
    // net48 build: no System.Text.Json (not in the framework). We use
    // System.Web.Script.Serialization.JavaScriptSerializer (System.Web.Extensions.dll,
    // ships with .NET Framework — no NuGet).
    //
    // Inbound: deserialize each line to Dictionary<string,object> and read fields
    //          defensively. JavaScriptSerializer hands back:
    //            string  → string
    //            int     → int (or long if large)
    //            decimal → decimal/double
    //            bool    → bool
    //            array   → ArrayList
    //            object  → Dictionary<string,object>
    // Outbound: build a Dictionary<string,object> per message, omitting null fields,
    //           then Serialize(...). The wire schema is identical to the old DTOs.
    // ─────────────────────────────────────────────────────────────────────────────

    /// <summary>Shared serializer. Stateless; safe to reuse.</summary>
    internal static class Json
    {
        public static readonly JavaScriptSerializer Serializer = NewSerializer();

        private static JavaScriptSerializer NewSerializer()
        {
            var s = new JavaScriptSerializer();
            // Effectively unbounded for our tiny grammar/result payloads.
            s.MaxJsonLength = int.MaxValue;
            return s;
        }

        /// <summary>Parse one stdin line into a string-keyed map. Throws on malformed JSON.</summary>
        public static Dictionary<string, object> ParseObject(string line)
        {
            // DeserializeObject returns object; a top-level JSON object comes back as
            // Dictionary<string,object>. Anything else (array/scalar) → not a message.
            object raw = Serializer.DeserializeObject(line);
            return raw as Dictionary<string, object>;
        }

        /// <summary>Serialize a message map to a single-line JSON string.</summary>
        public static string Serialize(Dictionary<string, object> map)
        {
            return Serializer.Serialize(map);
        }
    }

    // ── BB → helper (decoded defensively from Dictionary<string,object>) ───────────

    /// <summary>A single verb: an id plus the spoken phrases that collapse to it.</summary>
    internal sealed class VerbSpec
    {
        public string Id;
        public List<string> Phrases = new List<string>();
    }

    /// <summary>
    /// Inbound message parsed out of a raw Dictionary&lt;string,object&gt;. "t" is the
    /// discriminator; the other fields are populated only for the message types that use them.
    ///   grammar : Verbs (ArrayList of Dictionary), Shots (Dictionary&lt;string, ArrayList&gt;)
    ///   listen  : On (bool)
    ///   mic     : DeviceId (string)
    /// </summary>
    internal sealed class InboundMessage
    {
        public string T;

        // grammar
        public List<VerbSpec> Verbs;
        public Dictionary<string, List<string>> Shots;
        public string WakeWord;   // grammar: required spoken prefix (hands-free); null/empty = PTT

        // listen / wake
        public bool? On;

        // mic
        public string DeviceId;

        /// <summary>
        /// Build an InboundMessage from a raw JSON map. Tolerant: missing/extra fields and
        /// unexpected runtime types are ignored rather than throwing.
        /// </summary>
        public static InboundMessage From(Dictionary<string, object> map)
        {
            var msg = new InboundMessage();
            if (map == null) return msg;

            msg.T = GetString(map, "t");

            // grammar.verbs : ArrayList of { id, phrases:[...] }
            object verbsObj;
            if (map.TryGetValue("verbs", out verbsObj))
                msg.Verbs = ParseVerbs(verbsObj);

            // grammar.shots : { "1": ["3","drummer"], ... }
            object shotsObj;
            if (map.TryGetValue("shots", out shotsObj))
                msg.Shots = ParseShots(shotsObj);

            // grammar.wakeWord : string (required prefix in hands-free mode; absent/"" = PTT)
            msg.WakeWord = GetString(map, "wakeWord");

            // listen.on : bool
            object onObj;
            if (map.TryGetValue("on", out onObj))
                msg.On = AsBool(onObj);

            // mic.deviceId : string
            msg.DeviceId = GetString(map, "deviceId");

            return msg;
        }

        private static List<VerbSpec> ParseVerbs(object verbsObj)
        {
            var list = new List<VerbSpec>();
            var arr = verbsObj as IEnumerable;
            if (arr == null) return list;

            foreach (object item in arr)
            {
                var vd = item as Dictionary<string, object>;
                if (vd == null) continue;

                var spec = new VerbSpec();
                spec.Id = GetString(vd, "id");

                object phrasesObj;
                if (vd.TryGetValue("phrases", out phrasesObj))
                {
                    var pArr = phrasesObj as IEnumerable;
                    if (pArr != null)
                    {
                        foreach (object p in pArr)
                        {
                            if (p == null) continue;
                            spec.Phrases.Add(p.ToString());
                        }
                    }
                }
                list.Add(spec);
            }
            return list;
        }

        private static Dictionary<string, List<string>> ParseShots(object shotsObj)
        {
            var map = new Dictionary<string, List<string>>();
            var sd = shotsObj as Dictionary<string, object>;
            if (sd == null) return map;

            foreach (KeyValuePair<string, object> kv in sd)
            {
                var tokens = new List<string>();
                var arr = kv.Value as IEnumerable;
                if (arr != null)
                {
                    foreach (object tok in arr)
                    {
                        if (tok == null) continue;
                        // tokens may come back as string ("drummer") or number ("3" → int 3).
                        tokens.Add(Stringify(tok));
                    }
                }
                map[kv.Key] = tokens;
            }
            return map;
        }

        private static string GetString(Dictionary<string, object> map, string key)
        {
            object v;
            if (map != null && map.TryGetValue(key, out v) && v != null)
                return v.ToString();
            return null;
        }

        private static bool? AsBool(object v)
        {
            if (v == null) return null;
            if (v is bool) return (bool)v;
            bool b;
            if (bool.TryParse(v.ToString(), out b)) return b;
            // Numeric truthiness (1/0) just in case BB ever sends a number.
            if (v is int) return ((int)v) != 0;
            if (v is long) return ((long)v) != 0L;
            return null;
        }

        /// <summary>Culture-invariant string form for shot tokens (numbers must serialize as "3", not "3,0").</summary>
        private static string Stringify(object v)
        {
            if (v is string) return (string)v;
            if (v is IFormattable) return ((IFormattable)v).ToString(null, CultureInfo.InvariantCulture);
            return v.ToString();
        }
    }

    // ── helper → BB (built as Dictionary<string,object>, null fields omitted) ───────

    /// <summary>
    /// Factory for the outbound message maps. Each method returns a fresh
    /// Dictionary&lt;string,object&gt; with the exact wire keys; callers pass it to
    /// Json.Serialize. Keys whose value is null are never added.
    /// </summary>
    internal static class Outbound
    {
        public static Dictionary<string, object> Ready()
        {
            var m = new Dictionary<string, object>();
            m["t"] = "ready";
            return m;
        }

        public static Dictionary<string, object> Pong()
        {
            var m = new Dictionary<string, object>();
            m["t"] = "pong";
            return m;
        }

        public static Dictionary<string, object> Error(string reason)
        {
            var m = new Dictionary<string, object>();
            m["t"] = "error";
            m["reason"] = reason ?? "";
            return m;
        }

        public static Dictionary<string, object> Reject(string reason, float confidence)
        {
            var m = new Dictionary<string, object>();
            m["t"] = "reject";
            m["reason"] = reason ?? "no-match";
            m["confidence"] = confidence;
            return m;
        }

        /// <summary>
        /// Result message. camera/target/from/to are omitted when null (no key emitted),
        /// matching the old WhenWritingNull behavior. verb + confidence are always present.
        /// </summary>
        public static Dictionary<string, object> Result(
            int? camera, string verb, object target, object from, object to, float confidence)
        {
            var m = new Dictionary<string, object>();
            m["t"] = "result";
            if (camera.HasValue) m["camera"] = camera.Value;
            m["verb"] = verb ?? "";
            if (target != null) m["target"] = target;
            if (from != null) m["from"] = from;
            if (to != null) m["to"] = to;
            m["confidence"] = confidence;
            return m;
        }
    }
}
