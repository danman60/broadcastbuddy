using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// pad-helper: reads the first connected Xbox controller through XInput and prints its state
// as one JSON line per change (plus a 1 s heartbeat) to stdout. BB's main process relays it
// to the renderer so the controller works while OBS (not BB) has focus — Chromium's Gamepad
// API only feeds the focused window. Exits when stdin closes (BB quit).
// Line: {"c":true,"b":[17 values 0..1, W3C standard order],"a":[lx,ly,rx,ry]} or {"c":false}
internal static class Program
{
    [StructLayout(LayoutKind.Sequential)]
    private struct XINPUT_STATE { public uint dwPacketNumber; public ushort wButtons; public byte bLeftTrigger, bRightTrigger; public short sThumbLX, sThumbLY, sThumbRX, sThumbRY; }

    [DllImport("xinput1_4.dll", EntryPoint = "#100")] private static extern int XInputGetStateEx(int idx, out XINPUT_STATE s); // includes Guide
    [DllImport("xinput1_4.dll")] private static extern int XInputGetState(int idx, out XINPUT_STATE s);

    // XInput button bits in W3C "standard" gamepad order (index 0..16), triggers handled separately.
    private static readonly int[] Bits = { 0x1000, 0x2000, 0x4000, 0x8000, 0x0100, 0x0200, -1, -1, 0x0020, 0x0010, 0x0040, 0x0080, 0x0001, 0x0002, 0x0004, 0x0008, 0x0400 };

    private static bool _useEx = true;

    private static int Read(int i, out XINPUT_STATE s)
    {
        if (_useEx) { try { return XInputGetStateEx(i, out s); } catch (EntryPointNotFoundException) { _useEx = false; } }
        return XInputGetState(i, out s);
    }

    private static string F(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }
    private static double Axis(short v) { return Math.Max(-1.0, v / 32767.0); }

    private static int Main()
    {
        new Thread(() => { try { while (Console.In.ReadLine() != null) { } } catch { } Environment.Exit(0); }) { IsBackground = true }.Start();
        string last = null;
        DateTime lastSent = DateTime.MinValue;
        while (true)
        {
            string line = "{\"c\":false}";
            for (int i = 0; i < 4; i++)
            {
                XINPUT_STATE s;
                if (Read(i, out s) != 0) continue;
                var sb = new StringBuilder("{\"c\":true,\"b\":[");
                for (int k = 0; k < Bits.Length; k++)
                {
                    double v = k == 6 ? s.bLeftTrigger / 255.0 : k == 7 ? s.bRightTrigger / 255.0 : ((s.wButtons & Bits[k]) != 0 ? 1 : 0);
                    if (k > 0) sb.Append(',');
                    sb.Append(F(v));
                }
                // XInput Y is up-positive; the W3C standard mapping is up-negative.
                sb.Append("],\"a\":[").Append(F(Axis(s.sThumbLX))).Append(',').Append(F(-Axis(s.sThumbLY))).Append(',')
                  .Append(F(Axis(s.sThumbRX))).Append(',').Append(F(-Axis(s.sThumbRY))).Append("]}");
                line = sb.ToString();
                break;
            }
            if (line != last || (DateTime.UtcNow - lastSent).TotalSeconds >= 1)
            {
                Console.Out.WriteLine(line);
                Console.Out.Flush();
                last = line;
                lastSent = DateTime.UtcNow;
            }
            Thread.Sleep(8);
        }
    }
}
