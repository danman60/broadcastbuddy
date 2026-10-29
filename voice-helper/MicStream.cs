using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace VoiceHelper
{
    // Captures ONE named input device (winmm waveIn, 16 kHz / 16-bit / mono via the wave mapper)
    // and exposes it as a blocking Stream for SpeechRecognitionEngine.SetInputToAudioStream.
    // System.Speech itself can only open the Windows default mic — this is how the picker works.
    internal sealed class MicStream : Stream
    {
        public const int Rate = 16000;
        private const int BufBytes = 3200;              // 100 ms per waveIn buffer
        private const int Buffers = 8;
        private const int MaxQueued = Rate * 2 * 2;     // drop audio older than ~2 s (nobody reading)

        [StructLayout(LayoutKind.Sequential)]
        private struct WAVEFORMATEX { public ushort wFormatTag, nChannels; public uint nSamplesPerSec, nAvgBytesPerSec; public ushort nBlockAlign, wBitsPerSample, cbSize; }

        [StructLayout(LayoutKind.Sequential)]
        private struct WAVEHDR { public IntPtr lpData; public uint dwBufferLength, dwBytesRecorded; public IntPtr dwUser; public uint dwFlags, dwLoops; public IntPtr lpNext, reserved; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WAVEINCAPS { public ushort wMid, wPid; public uint vDriverVersion; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname; public uint dwFormats; public ushort wChannels, wReserved1; }

        [DllImport("winmm.dll")] private static extern int waveInGetNumDevs();
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)] private static extern int waveInGetDevCaps(IntPtr id, ref WAVEINCAPS caps, int size);
        [DllImport("winmm.dll")] private static extern int waveInOpen(out IntPtr h, IntPtr id, ref WAVEFORMATEX fmt, IntPtr cb, IntPtr inst, int flags);
        [DllImport("winmm.dll")] private static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] private static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] private static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, int size);
        [DllImport("winmm.dll")] private static extern int waveInStart(IntPtr h);
        [DllImport("winmm.dll")] private static extern int waveInReset(IntPtr h);
        [DllImport("winmm.dll")] private static extern int waveInClose(IntPtr h);

        private const int CALLBACK_EVENT = 0x50000, WAVE_MAPPED = 0x4, WHDR_DONE = 0x1;
        private static readonly int HdrSize = Marshal.SizeOf(typeof(WAVEHDR));
        private static readonly int FlagsOff = (int)Marshal.OffsetOf(typeof(WAVEHDR), "dwFlags");
        private static readonly int RecOff = (int)Marshal.OffsetOf(typeof(WAVEHDR), "dwBytesRecorded");

        private IntPtr _h;
        private readonly IntPtr[] _hdrs = new IntPtr[Buffers];
        private readonly AutoResetEvent _evt = new AutoResetEvent(false);
        private readonly Queue<byte[]> _q = new Queue<byte[]>();
        private int _queued, _headOff;
        private volatile bool _closed;
        private Thread _pump;
        public string Name { get; private set; }
        private long BytesRead;                         // reported as Position (SAPI probes it)
        public volatile int Peak;                       // max |sample| since Discard (0-32767)
        private int _meterPeak;                         // separate window; never resets the PTT silence detector

        public int TakeMeterPeak() { return Interlocked.Exchange(ref _meterPeak, 0); }

        public static MicStream OpenDefault()
        {
            var s = new MicStream { Name = "Windows default" };
            s.Start(-1); // WAVE_MAPPER uses the current Windows default input
            return s;
        }

        /// <summary>All waveIn device names (Windows truncates them to 31 chars).</summary>
        public static List<string> DeviceNames()
        {
            var names = new List<string>();
            int n = waveInGetNumDevs();
            for (int i = 0; i < n; i++)
            {
                var c = new WAVEINCAPS();
                if (waveInGetDevCaps((IntPtr)i, ref c, Marshal.SizeOf(typeof(WAVEINCAPS))) == 0) names.Add(c.szPname ?? "");
            }
            return names;
        }

        /// <summary>Open the device whose (truncated) waveIn name the picker label starts with; null = no match.</summary>
        public static MicStream Open(string label)
        {
            List<string> names = DeviceNames();
            for (int i = 0; i < names.Count; i++)
            {
                string nm = names[i];
                if (nm.Length == 0 || !label.StartsWith(nm, StringComparison.OrdinalIgnoreCase)) continue;
                var s = new MicStream { Name = nm };
                s.Start(i);
                return s;
            }
            return null;
        }

        private void Start(int id)
        {
            var fmt = new WAVEFORMATEX { wFormatTag = 1, nChannels = 1, nSamplesPerSec = Rate, wBitsPerSample = 16, nBlockAlign = 2, nAvgBytesPerSec = Rate * 2 };
            // WAVE_MAPPED requires a concrete device id; the default mapper (-1)
            // rejects that flag with MMSYSERR_INVALFLAG (10).
            int flags = CALLBACK_EVENT | (id == -1 ? 0 : WAVE_MAPPED);
            int rc = waveInOpen(out _h, (IntPtr)id, ref fmt, _evt.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, flags);
            if (rc != 0) throw new IOException("waveInOpen " + rc);
            for (int i = 0; i < Buffers; i++)
            {
                var hdr = new WAVEHDR { lpData = Marshal.AllocHGlobal(BufBytes), dwBufferLength = BufBytes };
                _hdrs[i] = Marshal.AllocHGlobal(HdrSize);
                Marshal.StructureToPtr(hdr, _hdrs[i], false);
                Check("waveInPrepareHeader", waveInPrepareHeader(_h, _hdrs[i], HdrSize));
                Check("waveInAddBuffer", waveInAddBuffer(_h, _hdrs[i], HdrSize));
            }
            Check("waveInStart", waveInStart(_h));
            _pump = new Thread(Pump) { IsBackground = true, Name = "mic-pump" };
            _pump.Start();
        }

        private static void Check(string fn, int rc) { if (rc != 0) throw new IOException(fn + " " + rc); }

        private void Pump()
        {
            while (!_closed)
            {
                _evt.WaitOne(200);
                foreach (IntPtr hdr in _hdrs)
                {
                    if (_closed) return;
                    if ((Marshal.ReadInt32(hdr, FlagsOff) & WHDR_DONE) == 0) continue;
                    int n = Marshal.ReadInt32(hdr, RecOff);
                    if (n > 0)
                    {
                        var chunk = new byte[n];
                        Marshal.Copy(Marshal.ReadIntPtr(hdr), chunk, 0, n);
                        int pk = 0;
                        for (int k = 0; k + 1 < n; k += 2) { int v = Math.Abs((int)BitConverter.ToInt16(chunk, k)); if (v > pk) pk = v; }
                        if (pk > Peak) Peak = pk;
                        int prior;
                        do { prior = _meterPeak; if (pk <= prior) break; }
                        while (Interlocked.CompareExchange(ref _meterPeak, pk, prior) != prior);
                        lock (_q)
                        {
                            _q.Enqueue(chunk); _queued += n;
                            while (_queued > MaxQueued) { _queued -= _q.Dequeue().Length - _headOff; _headOff = 0; }
                            Monitor.PulseAll(_q);
                        }
                    }
                    Marshal.WriteInt32(hdr, FlagsOff, Marshal.ReadInt32(hdr, FlagsOff) & ~WHDR_DONE);
                    waveInAddBuffer(_h, hdr, HdrSize);
                }
            }
        }

        /// <summary>Drop buffered audio so a new PTT hold never hears what was said before it.</summary>
        public void Discard()
        {
            lock (_q) { _q.Clear(); _queued = 0; _headOff = 0; }
            Peak = 0;
        }

        // Fills the WHOLE request (blocking): SAPI treats a short read as end-of-stream and stalls.
        public override int Read(byte[] buffer, int offset, int count)
        {
            int done = 0;
            lock (_q)
            {
                while (done < count)
                {
                    while (_q.Count == 0 && !_closed) Monitor.Wait(_q, 500);
                    if (_q.Count == 0) break; // closed
                    byte[] head = _q.Peek();
                    int n = Math.Min(count - done, head.Length - _headOff);
                    Buffer.BlockCopy(head, _headOff, buffer, offset + done, n);
                    _headOff += n; _queued -= n; done += n;
                    if (_headOff == head.Length) { _q.Dequeue(); _headOff = 0; }
                }
            }
            BytesRead += done;
            return done;
        }

        protected override void Dispose(bool disposing)
        {
            if (_closed) return;
            _closed = true;
            lock (_q) Monitor.PulseAll(_q);
            try { _pump?.Join(1000); } catch { }
            if (_h != IntPtr.Zero)
            {
                waveInReset(_h);
                foreach (IntPtr hdr in _hdrs)
                {
                    if (hdr == IntPtr.Zero) continue;
                    waveInUnprepareHeader(_h, hdr, HdrSize);
                    Marshal.FreeHGlobal(Marshal.ReadIntPtr(hdr));
                    Marshal.FreeHGlobal(hdr);
                }
                waveInClose(_h);
                _h = IntPtr.Zero;
            }
            base.Dispose(disposing);
        }

        // Live capture: forward-only. SAPI still probes Seek/Position, so those must not throw.
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { return -1; } }
        public override long Position { get { return BytesRead; } set { } }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) { return BytesRead; } // SAPI probes Seek(0, Current); throwing aborts recognition
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
    }
}
