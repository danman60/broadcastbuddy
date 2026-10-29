using System;
using System.Collections.Generic;
using System.Speech.Recognition;
namespace VoiceHelper {
  internal static class Harness {
    static Choices N8(string[] w) { var c = new Choices(); for (int i = 0; i < w.Length; i++) c.Add(new SemanticResultValue(w[i], i + 1)); return c; }
    static VerbSpec V(string id, params string[] p) { var v = new VerbSpec(); v.Id = id; v.Phrases = new List<string>(p); return v; }
    static List<VerbSpec> AllV() { return new List<VerbSpec> { V("select","camera one","camera two"), V("recall","shot","go to shot","preset","go to preset"), V("pushIn","push in"), V("slowPushIn","slow push in","slow push"), V("pullOut","pull out","zoom out"), V("zoomIn","zoom in"), V("wide","wide","go wide","home"), V("track","track","follow"), V("stop","stop") }; }
    static Choices N() { var c = new Choices(); c.Add(new SemanticResultValue("three", 3)); c.Add(new SemanticResultValue("four", 4)); return c; }
    static void Try(string name, Func<GrammarBuilder> mk) {
      try { new Grammar(mk()); Console.WriteLine("OK   " + name); } catch (Exception ex) { Console.WriteLine("FAIL " + name + " : " + ex.GetType().Name); }
    }
    static void Main() {
      foreach (var toks in new[] { new[]{"1"}, new[]{"1","drummer"}, new[]{"1","2","3","4","5","6","7","8","drummer","stage left"} }) {
        
        var shots = new Dictionary<string, List<string>> { { "1", new List<string>(toks) } };
        try { GrammarFactory.Build(AllV(), shots, ""); GrammarFactory.Build(AllV(), shots, "broadcast"); Console.WriteLine("OK   factory sweep " + string.Join(",", toks)); }
        catch (Exception ex) { Console.WriteLine("FAIL factory sweep " + string.Join(",", toks) + " : " + ex.ToString()); }
      }
      Console.WriteLine("---");

      Func<GrammarBuilder> sw = () => { var g = new GrammarBuilder(); g.Append(new SemanticResultKey("verb", new SemanticResultValue("sweep"))); g.Append(new Choices("sweep")); g.Append(new SemanticResultKey("from", N())); g.Append("to"); g.Append(new SemanticResultKey("to", N())); return g; };
      Func<GrammarBuilder> spoken = () => { var n = new Choices(); n.Add(new SemanticResultValue("one", 1)); n.Add(new SemanticResultValue("two", 2)); var s2 = new GrammarBuilder("camera"); s2.Append(new SemanticResultKey("camera", n)); return s2; };
      Try("emptyChoice prefix + sweep", () => { var u = new GrammarBuilder(new Choices(new GrammarBuilder[] { new GrammarBuilder(), spoken() })); u.Append(new GrammarBuilder(new Choices(new GrammarBuilder[] { sw() }))); return u; });
      Try("repeat01 prefix + sweep", () => { var u = new GrammarBuilder(); u.Append(spoken(), 0, 1); u.Append(new GrammarBuilder(new Choices(new GrammarBuilder[] { sw() }))); return u; });
      Try("repeat01 prefix + sweep (no outer choices)", () => { var u = new GrammarBuilder(); u.Append(spoken(), 0, 1); u.Append(sw()); return u; });
      Try("no prefix + choices(sweep)", () => { var u = new GrammarBuilder(); u.Append(new GrammarBuilder(new Choices(new GrammarBuilder[] { sw() }))); return u; });
      Try("literal prefix + sweep", () => { var u = spoken(); u.Append(sw()); return u; });

      var all8 = new[]{"one","two","three","four","five","six","seven","eight"};
      var no2 = new[]{"one","three","four","five","six","seven","eight"};
      Try("keys, 1-8", () => { var g = new GrammarBuilder("sweep"); g.Append(new SemanticResultKey("from", N8(all8))); g.Append("to"); g.Append(new SemanticResultKey("to", N8(all8))); return g; });
      Try("keys, 1-8 minus two", () => { var g = new GrammarBuilder("sweep"); g.Append(new SemanticResultKey("from", N8(no2))); g.Append("to"); g.Append(new SemanticResultKey("to", N8(no2))); return g; });
      Try("no keys, 1-8", () => { var g = new GrammarBuilder("sweep"); g.Append(N8(all8)); g.Append("to"); g.Append(N8(all8)); return g; });
      Try("keys, 1-8, until", () => { var g = new GrammarBuilder("sweep"); g.Append(new SemanticResultKey("from", N8(all8))); g.Append("until"); g.Append(new SemanticResultKey("to", N8(all8))); return g; });

      Try("sweep N to N (no keys)", () => { var g = new GrammarBuilder("sweep"); g.Append(N()); g.Append("to"); g.Append(N()); return g; });
      Try("sweep from-key N to N", () => { var g = new GrammarBuilder("sweep"); g.Append(new SemanticResultKey("from", N())); g.Append("to"); g.Append(N()); return g; });
      Try("sweep from to keys", () => { var g = new GrammarBuilder("sweep"); g.Append(new SemanticResultKey("from", N())); g.Append("to"); g.Append(new SemanticResultKey("to", N())); return g; });
      Try("keys named a/b", () => { var g = new GrammarBuilder("sweep"); g.Append(new SemanticResultKey("a", N())); g.Append("to"); g.Append(new SemanticResultKey("b", N())); return g; });
      Try("keys, literal 'until'", () => { var g = new GrammarBuilder("sweep"); g.Append(new SemanticResultKey("from", N())); g.Append("until"); g.Append(new SemanticResultKey("to", N())); return g; });
      Try("verb tag + keys", () => { var g = new GrammarBuilder(); g.Append(new SemanticResultKey("verb", new SemanticResultValue("sweep"))); g.Append(new Choices("sweep")); g.Append(new SemanticResultKey("from", N())); g.Append("to"); g.Append(new SemanticResultKey("to", N())); return g; });
    }
  }
}
