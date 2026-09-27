using System.Net.Sockets;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using PokemonSuite;

void Check(bool condition,string message) { if(!condition)throw new Exception(message); }
string path=Path.Combine(Path.GetTempPath(),"ps-test-"+Guid.NewGuid().ToString("N")+".sock");
Environment.SetEnvironmentVariable("POKEMON_SUITE_SOCKET",path);
using Socket server=new(AddressFamily.Unix,SocketType.Stream,ProtocolType.Unspecified);
server.Bind(new UnixDomainSocketEndPoint(path));server.Listen(1);
SuiteBridge.WantsFrame();
using Socket client=server.Accept();using NetworkStream stream=new(client);stream.ReadTimeout=3000;
void Send(object value){stream.Write(JsonSerializer.SerializeToUtf8Bytes(value));stream.WriteByte(10);}
(string Kind,byte[] Data) Read(){byte[] header=new byte[8];stream.ReadExactly(header);int count=BinaryPrimitives.ReadInt32BigEndian(header.AsSpan(4));Check(count>0&&count<10000,"Packet bound");byte[] data=new byte[count];stream.ReadExactly(data);return(Encoding.ASCII.GetString(header,0,4),data);}
try {
 Thread.Sleep(50);Send(new{buttons=1,lx=90000,ly=-90000,rx=5,ry=0});Thread.Sleep(50);
 Check(SuiteBridge.Input(0)==1&&SuiteBridge.Input(1)==32767&&SuiteBridge.Input(2)==-32767,"Native controller clamps axes");
 Thread.Sleep(1100);Check(SuiteBridge.Input(0)==0&&SuiteBridge.Input(1)==0,"Abandoned controller releases after one second");
 SuiteBridge.Video(1,1,true,new byte[]{1,2,3,255},true,false);var frame=Read();
 Check(frame.Kind=="VID2"&&frame.Data.Length==16&&BinaryPrimitives.ReadInt32BigEndian(frame.Data.AsSpan(8))==3,"Frame dimensions and orientation are preserved");
 string answer="";var request=Task.Run(()=>SuiteBridge.Text("Trainer name","Choose your name","",1,12,out answer));
 var prompt=Read();using var doc=JsonDocument.Parse(prompt.Data);string id=doc.RootElement.GetProperty("id").GetString();
 Send(new{requestId="stale",text="Wrong"});Thread.Sleep(30);Check(!request.IsCompleted,"Stale text response must not answer a new prompt");
 Send(new{requestId=id,text="Player"});Check(request.Wait(2000)&&request.Result&&answer=="Player","Explicit player text reaches the game");
 var closed=Read();Check(closed.Kind=="REQ1"&&Encoding.UTF8.GetString(closed.Data)=="null","Prompt closes after the answer");
 var dispatchHook=typeof(SuiteBridge).GetMethod("DispatchToMainThread");
 Check(dispatchHook!=null,"Concurrent native dispatches need independent acknowledgements");
 using var queued=new System.Collections.Concurrent.BlockingCollection<Action>();
 Action<Action> enqueue=queued.Add;
 var firstDispatch=Task.Run(()=>dispatchHook.Invoke(null,new object[]{(Action)(()=>{}),enqueue}));
 var firstWork=queued.Take();
 var secondDispatch=Task.Run(()=>dispatchHook.Invoke(null,new object[]{(Action)(()=>{}),enqueue}));
 var secondWork=queued.Take();secondWork();
 Check(secondDispatch.Wait(1000)&&!firstDispatch.IsCompleted,"An SDL poll must not acknowledge another thread's surface creation");
 firstWork();Check(firstDispatch.Wait(1000),"Each dispatch completes only after its own action");
 var closing=Task.Run(()=>SuiteBridge.Text("Trainer name","","",1,12,out answer));
 Read();
 var dispatchMethod=typeof(SuiteBridge).GetMethod("WaitForDispatch");
 Check(dispatchMethod!=null,"Native shutdown must release queued SDL dispatch waits");
 using AutoResetEvent dispatchEvent=new(false);
 var dispatch=Task.Run(()=>(bool)dispatchMethod.Invoke(null,new object[]{dispatchEvent}));
 Thread.Sleep(30);Check(!dispatch.IsCompleted,"Normal SDL dispatch still waits for the main thread");
 Send(new { quit=true });
 Check(dispatch.Wait(2000)&&!dispatch.Result,"Close releases an SDL dispatch after its main loop stops");
 Check(closing.Wait(2000)&&!closing.Result,"Closing releases a waiting game keyboard without inventing text");
 var shouldClose=typeof(SuiteBridge).GetMethod("ShouldClose");
 Check(shouldClose!=null&&(bool)shouldClose.Invoke(null,null),"Close request reaches the native event loop");
 Check(SuiteBridge.Input(0)==0,"Closing releases the controller");
 Console.WriteLine("PASS: native framing, analog bounds, input expiry, stale prompt rejection, explicit text entry.");
} finally { File.Delete(path); }
