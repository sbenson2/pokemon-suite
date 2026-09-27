using Mono.Cecil;
using Mono.Cecil.Cil;

// Only patches a private, verified release copy. Original cartridges and saves stay intact.
string root = Path.GetFullPath(args[0]);
using var bridge = AssemblyDefinition.ReadAssembly(Path.GetFullPath(args[1]));
var bridgeType = bridge.MainModule.Types.Single(t => t.FullName == "PokemonSuite.SuiteBridge");
var resolver = new DefaultAssemblyResolver(); resolver.AddSearchDirectory(root);
AssemblyDefinition Read(string name) => AssemblyDefinition.ReadAssembly(Path.Combine(root, name + ".dll"), new ReaderParameters { AssemblyResolver = resolver });
MethodReference Hook(ModuleDefinition m, string name) => m.ImportReference(bridgeType.Methods.Single(x => x.Name == name));
void Save(AssemblyDefinition a) {
 string path = Path.Combine(root, a.Name.Name + ".dll");
 a.Write(path + ".suite"); a.Dispose(); File.Move(path + ".suite", path, true);
}
void Insert(ILProcessor il, Instruction at, params Instruction[] code) { foreach (var item in code) il.InsertBefore(at, item); }

using var vulkan = Read("Ryujinx.Graphics.Vulkan");
var module = vulkan.MainModule;
var window = module.Types.Single(t => t.FullName == "Ryujinx.Graphics.Vulkan.Window");
var present = window.Methods.Single(m => m.Name == "Present");
var request = present.Body.Instructions.Single(i => i.Operand is MethodReference m && m.Name == "get_ScreenCaptureRequested");
var pil = present.Body.GetILProcessor();
var wants = Instruction.Create(OpCodes.Call, Hook(module, "WantsFrame")); pil.InsertAfter(request, wants); pil.InsertAfter(wants, Instruction.Create(OpCodes.Or));
var capture = window.Methods.Single(m => m.Name == "CaptureFrame");
var cil = capture.Body.GetILProcessor(); var original = capture.Body.Instructions.First(i => i.OpCode == OpCodes.Stloc_0).Next;
Insert(cil, original, Instruction.Create(OpCodes.Call, Hook(module, "get_Enabled")), Instruction.Create(OpCodes.Brfalse, original),
 Instruction.Create(OpCodes.Ldarg, capture.Parameters[3]), Instruction.Create(OpCodes.Ldarg, capture.Parameters[4]),
 Instruction.Create(OpCodes.Ldarg, capture.Parameters[5]), Instruction.Create(OpCodes.Ldloc_0),
 Instruction.Create(OpCodes.Ldarg, capture.Parameters[6]), Instruction.Create(OpCodes.Ldarg, capture.Parameters[7]),
 Instruction.Create(OpCodes.Call, Hook(module, "Video")), Instruction.Create(OpCodes.Ret));
Save(vulkan);

using var input = Read("Ryujinx.Input"); module = input.MainModule;
var controller = module.Types.Single(t => t.FullName == "Ryujinx.Input.HLE.NpadController");
var method = controller.Methods.Single(m => m.Name == "GetHLEInputState");
var il = method.Body.GetILProcessor(); original = method.Body.Instructions[0];
var state = method.ReturnType.Resolve(); var local = new VariableDefinition(module.ImportReference(state)); method.Body.Variables.Add(local); method.Body.InitLocals = true;
var code = new List<Instruction> { Instruction.Create(OpCodes.Call, Hook(module, "get_Enabled")), Instruction.Create(OpCodes.Brfalse, original),
 Instruction.Create(OpCodes.Ldloca, local), Instruction.Create(OpCodes.Initobj, module.ImportReference(state)),
 Instruction.Create(OpCodes.Ldloca, local), Instruction.Create(OpCodes.Ldc_I4_0), Instruction.Create(OpCodes.Call, Hook(module, "Input")),
 Instruction.Create(OpCodes.Conv_I8), Instruction.Create(OpCodes.Stfld, module.ImportReference(state.Fields.Single(f => f.Name == "Buttons"))) };
int axis = 1;
foreach (var name in new[] { "LStick", "RStick" }) {
 var stick = state.Fields.Single(f => f.Name == name);
 foreach (var xy in new[] { "Dx", "Dy" })
  code.AddRange(new[] { Instruction.Create(OpCodes.Ldloca, local), Instruction.Create(OpCodes.Ldflda, module.ImportReference(stick)),
   Instruction.Create(OpCodes.Ldc_I4, axis++), Instruction.Create(OpCodes.Call, Hook(module, "Input")),
   Instruction.Create(OpCodes.Stfld, module.ImportReference(stick.FieldType.Resolve().Fields.Single(f => f.Name == xy))) });
}
code.Add(Instruction.Create(OpCodes.Ldloc, local)); code.Add(Instruction.Create(OpCodes.Ret)); Insert(il, original, code.ToArray()); Save(input);

using var audio = Read("Ryujinx.Audio.Backends.SDL2"); module = audio.MainModule;
var session = module.Types.Single(t => t.FullName == "Ryujinx.Audio.Backends.SDL2.SDL2HardwareDeviceSession");
method = session.Methods.Single(m => m.Name == "QueueBuffer"); il = method.Body.GetILProcessor(); original = method.Body.Instructions[0];
code = new() { Instruction.Create(OpCodes.Call, Hook(module, "get_Enabled")), Instruction.Create(OpCodes.Brfalse, original),
 Instruction.Create(OpCodes.Ldarg_1), Instruction.Create(OpCodes.Ldfld, module.ImportReference(method.Parameters[0].ParameterType.Resolve().Fields.Single(f => f.Name == "Data"))) };
foreach (var property in new[] { "RequestedSampleFormat", "RequestedSampleRate", "RequestedChannelCount" }) {
 code.Add(Instruction.Create(OpCodes.Ldarg_0)); code.Add(Instruction.Create(OpCodes.Call, module.ImportReference(session.BaseType.Resolve().Methods.Single(m => m.Name == "get_" + property))));
}
code.Add(Instruction.Create(OpCodes.Call, Hook(module, "Audio"))); Insert(il, original, code.ToArray()); Save(audio);

using var app = Read("Ryujinx"); module = app.MainModule;
IEnumerable<TypeDefinition> AllTypes(IEnumerable<TypeDefinition> types) {
 foreach (var type in types) { yield return type; foreach (var nested in AllTypes(type.NestedTypes)) yield return nested; }
}
var dispatcher = AllTypes(module.Types).SelectMany(t => t.Methods).Single(m => m.HasBody &&
 m.Body.Instructions.Any(i => i.Operand is MethodReference r && r.Name == "QueueMainThreadAction") &&
 m.Body.Instructions.Any(i => i.Operand is MethodReference r && r.Name == "WaitOne"));
var queueMain = (MethodReference)dispatcher.Body.Instructions.Single(i => i.Operand is MethodReference r && r.Name == "QueueMainThreadAction").Operand;
var dispatchHook = Hook(module, "DispatchToMainThread");
var enqueueCtor = new MethodReference(".ctor", module.TypeSystem.Void, dispatchHook.Parameters[1].ParameterType) { HasThis = true };
enqueueCtor.Parameters.Add(new ParameterDefinition(module.TypeSystem.Object));
enqueueCtor.Parameters.Add(new ParameterDefinition(module.TypeSystem.IntPtr));
original = dispatcher.Body.Instructions[0];
Insert(dispatcher.Body.GetILProcessor(), original,
 Instruction.Create(OpCodes.Call, Hook(module, "get_Enabled")), Instruction.Create(OpCodes.Brfalse, original),
 Instruction.Create(OpCodes.Ldarg, dispatcher.Parameters.Single()), Instruction.Create(OpCodes.Ldnull),
 Instruction.Create(OpCodes.Ldftn, queueMain), Instruction.Create(OpCodes.Newobj, enqueueCtor),
 Instruction.Create(OpCodes.Call, dispatchHook), Instruction.Create(OpCodes.Ret));
// Headless Vulkan otherwise waits inside RunLoop for DisposeGpu, while calling
// DisposeGpu only after that same loop returns. Match the GUI shutdown order:
// guest/filesystem disposal, GPU disposal, then native-window disposal.
var headless = module.Types.Single(t => t.FullName == "Ryujinx.Headless.HeadlessRyujinx");
var loadApplication = headless.Methods.Single(m => m.Name == "ExecutionEntrypoint");
var guestDispose = loadApplication.Body.Instructions.Single(i => i.Operand is MethodReference r && r.Name == "Dispose" && r.DeclaringType.FullName == "Ryujinx.HLE.Switch");
var afterGuest = guestDispose.Next;
var context = headless.Fields.Single(f => f.Name == "_emulationContext");
var disposeGpu = module.ImportReference(context.FieldType.Resolve().Methods.Single(m => m.Name == "DisposeGpu"));
Insert(loadApplication.Body.GetILProcessor(), afterGuest,
 Instruction.Create(OpCodes.Call, Hook(module, "get_Enabled")), Instruction.Create(OpCodes.Brfalse, afterGuest),
 Instruction.Create(OpCodes.Ldsfld, context), Instruction.Create(OpCodes.Callvirt, disposeGpu));
var vulkanWindow = module.Types.Single(t => t.FullName == "Ryujinx.Headless.VulkanWindow");
var finalize = vulkanWindow.Methods.Single(m => m.Name == "FinalizeWindowRenderer");
original = finalize.Body.Instructions[0];
Insert(finalize.Body.GetILProcessor(), original, Instruction.Create(OpCodes.Call, Hook(module, "get_Enabled")),
 Instruction.Create(OpCodes.Brfalse, original), Instruction.Create(OpCodes.Ret));
window = module.Types.Single(t => t.FullName == "Ryujinx.Headless.WindowBase");
// Exit through the SDL owner's normal loop so GPU work and filesystem handles
// are disposed, instead of terminating the operating-system process.
method = window.Methods.Single(m => m.Name == "UpdateFrame"); il = method.Body.GetILProcessor(); original = method.Body.Instructions[0];
Insert(il, original, Instruction.Create(OpCodes.Call, Hook(module, "ShouldClose")), Instruction.Create(OpCodes.Brfalse, original),
 Instruction.Create(OpCodes.Ldarg_0), Instruction.Create(OpCodes.Ldc_I4_0),
 Instruction.Create(OpCodes.Stfld, window.Fields.Single(f => f.Name == "_isActive")),
 Instruction.Create(OpCodes.Ldc_I4_0), Instruction.Create(OpCodes.Ret));
method = window.Methods.Single(m => m.Name == "DisplayInputDialog"); il = method.Body.GetILProcessor(); original = method.Body.Instructions[0];
code = new() { Instruction.Create(OpCodes.Call, Hook(module, "get_Enabled")), Instruction.Create(OpCodes.Brfalse, original) };
var keyboard = method.Parameters[0].ParameterType.Resolve();
foreach (var name in new[] { "HeaderText", "GuideText", "InitialText", "StringLengthMin", "StringLengthMax" }) {
 code.Add(Instruction.Create(OpCodes.Ldarga, method.Parameters[0])); code.Add(Instruction.Create(OpCodes.Ldfld, module.ImportReference(keyboard.Fields.Single(f => f.Name == name))));
}
code.Add(Instruction.Create(OpCodes.Ldarg_2)); code.Add(Instruction.Create(OpCodes.Call, Hook(module, "Text"))); code.Add(Instruction.Create(OpCodes.Ret));
Insert(il, original, code.ToArray()); Save(app);
File.Copy(Path.GetFullPath(args[1]), Path.Combine(root, "SuiteBridge.dll"), true);
Console.WriteLine("Installed four opt-in native transport hooks: video, audio, controller, text entry.");
