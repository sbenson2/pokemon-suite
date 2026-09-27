// Optional local transport for Pokémon Suite. No game memory or save editing.
using System.Buffers.Binary;
using System.Diagnostics;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace PokemonSuite;

public static class SuiteBridge
{
    private static readonly string? Path = Environment.GetEnvironmentVariable("POKEMON_SUITE_SOCKET");
    public static bool Enabled => !string.IsNullOrEmpty(Path);
    private static readonly object Gate = new();
    private static readonly AutoResetEvent Wake = new(false);
    private static readonly Queue<(string Kind, byte[] Data)> Events = new();
    private static (string Kind, byte[] Data)? Frame;
    private static bool Started, Connected, Closing;
    private static long LastInput;
    private static int Buttons, LX, LY, RX, RY;
    private static string? RequestId, Answer;
    private static bool Answered;

    private static void Start()
    {
        lock (Gate)
        {
            if (Started || !Enabled) return;
            Started = true;
            new Thread(Connect) { IsBackground = true, Name = "Suite native transport" }.Start();
        }
    }

    private static void Connect()
    {
        try
        {
            using Socket socket = new(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
            socket.Connect(new UnixDomainSocketEndPoint(Path!));
            using NetworkStream stream = new(socket);
            lock (Gate) Connected = true;
            new Thread(() => ReadInput(stream)) { IsBackground = true, Name = "Suite controller" }.Start();
            while (true)
            {
                Wake.WaitOne(1000);
                (string Kind, byte[] Data)? frame;
                (string Kind, byte[] Data)[] events;
                lock (Gate)
                {
                    if (!Connected) break;
                    frame = Frame; Frame = null;
                    events = Events.ToArray(); Events.Clear();
                }
                if (frame.HasValue) Write(stream, frame.Value);
                foreach (var item in events) Write(stream, item);
            }
        }
        catch (Exception error) { Console.Error.WriteLine("Suite transport: " + error.Message); }
        finally { lock (Gate) { Connected = false; Buttons = LX = LY = RX = RY = 0; Monitor.PulseAll(Gate); } }
    }

    private static void Write(Stream stream, (string Kind, byte[] Data) item)
    {
        byte[] header = new byte[8]; Encoding.ASCII.GetBytes(item.Kind).CopyTo(header, 0);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4), item.Data.Length);
        stream.Write(header); stream.Write(item.Data);
    }

    private static void ReadInput(Stream stream)
    {
        try
        {
            // Messages are bounded before JSON parsing, including clients without newlines.
            using MemoryStream line = new();
            while (true)
            {
                int b = stream.ReadByte(); if (b < 0) break;
                if (b != 10) { if (line.Length >= 8192) break; line.WriteByte((byte)b); continue; }
                using JsonDocument document = JsonDocument.Parse(line.ToArray()); line.SetLength(0);
                JsonElement v = document.RootElement;
                lock (Gate)
                {
                    if (v.TryGetProperty("quit", out var quit) && quit.ValueKind == JsonValueKind.True)
                    { Closing = true; Buttons = LX = LY = RX = RY = 0; Answer = null; Answered = true; Monitor.PulseAll(Gate); }
                    else if (v.TryGetProperty("requestId", out var id))
                    {
                        if (id.GetString() == RequestId && v.TryGetProperty("text", out var text))
                        { Answer = text.ValueKind == JsonValueKind.Null ? null : text.GetString(); Answered = true; Monitor.PulseAll(Gate); }
                    }
                    else
                    {
                        int number(string key) => v.TryGetProperty(key, out var n) ? n.GetInt32() : 0;
                        Buttons = number("buttons") & 0xffff;
                        LX = Math.Clamp(number("lx"), -32767, 32767); LY = Math.Clamp(number("ly"), -32767, 32767);
                        RX = Math.Clamp(number("rx"), -32767, 32767); RY = Math.Clamp(number("ry"), -32767, 32767);
                        LastInput = Stopwatch.GetTimestamp();
                    }
                }
            }
        }
        catch (Exception error) { Console.Error.WriteLine("Suite input: " + error.Message); }
        finally { lock (Gate) { Connected = false; Monitor.PulseAll(Gate); } Wake.Set(); }
    }

    public static bool WantsFrame() { Start(); lock (Gate) return Connected && Frame == null; }
    public static bool ShouldClose() { lock (Gate) return Enabled && Closing; }
    public static bool WaitForDispatch(WaitHandle completion)
    {
        if (!Enabled) return completion.WaitOne();
        // Once the main loop exits, no thread can acknowledge a queued SDL poll.
        // Release its worker so normal InputManager.Dispose can join it.
        while (!ShouldClose()) if (completion.WaitOne(10)) return true;
        return false;
    }
    public static void DispatchToMainThread(Action action, Action<Action> enqueue)
    {
        // A shared event lets an SDL poll acknowledge a different thread's
        // Vulkan surface creation before it finishes. Each call owns its signal.
        var completed = new AutoResetEvent(false);
        Exception? error = null;
        enqueue(() => { try { action(); } catch (Exception e) { error = e; } finally { completed.Set(); } });
        if (WaitForDispatch(completed))
        {
            completed.Dispose();
            if (error != null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(error).Throw();
        }
    }
    public static void Video(int width, int height, bool bgra, byte[] pixels, bool flipX, bool flipY)
    {
        Start();
        if (width < 1 || height < 1 || width > 3840 || height > 2160 || pixels.Length != width * height * 4) return;
        byte[] payload = new byte[12 + pixels.Length];
        BinaryPrimitives.WriteInt32BigEndian(payload, width); BinaryPrimitives.WriteInt32BigEndian(payload.AsSpan(4), height);
        BinaryPrimitives.WriteInt32BigEndian(payload.AsSpan(8), (bgra ? 1 : 0) | (flipX ? 2 : 0) | (flipY ? 4 : 0));
        pixels.CopyTo(payload, 12);
        lock (Gate) Frame = ("VID2", payload);
        Wake.Set();
    }

    public static void Audio(byte[] samples, int format, uint rate, uint channels)
    {
        Start(); if (samples.Length > 1024 * 1024) return;
        byte[] payload = new byte[12 + samples.Length];
        BinaryPrimitives.WriteInt32BigEndian(payload, format); BinaryPrimitives.WriteUInt32BigEndian(payload.AsSpan(4), rate);
        BinaryPrimitives.WriteUInt32BigEndian(payload.AsSpan(8), channels); samples.CopyTo(payload, 12);
        lock (Gate) { if (!Connected || Events.Count >= 30) return; Events.Enqueue(("AUD2", payload)); }
        Wake.Set();
    }

    public static int Input(int field)
    {
        Start(); lock (Gate)
        {
            if (Closing || !Connected || Stopwatch.GetElapsedTime(LastInput).TotalSeconds >= 1) return 0;
            return field switch { 0 => Buttons, 1 => LX, 2 => LY, 3 => RX, 4 => RY, _ => 0 };
        }
    }

    public static bool Text(string title, string guide, string initial, int min, int max, out string text)
    {
        Start(); text = "";
        lock (Gate)
        {
            if (!Connected || Closing) return false;
            RequestId = Guid.NewGuid().ToString("N"); Answered = false; Answer = null;
            Events.Enqueue(("REQ1", JsonSerializer.SerializeToUtf8Bytes(new { id = RequestId, title, guide, initial, min, max })));
            Wake.Set();
            while (Connected && !Answered) Monitor.Wait(Gate, 1000);
            bool accepted = Answered && Answer != null && Answer.Length >= min && Answer.Length <= max;
            text = accepted ? Answer! : ""; RequestId = null;
            Events.Enqueue(("REQ1", Encoding.UTF8.GetBytes("null"))); Wake.Set();
            return accepted;
        }
    }
}
