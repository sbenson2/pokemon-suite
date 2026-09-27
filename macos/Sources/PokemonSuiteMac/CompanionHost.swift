import AppKit
import SwiftUI
import SuiteCore

@MainActor final class CompanionHost:ObservableObject {
    @Published var code=""
    @Published var name=""
    @Published var error:String?
    @Published var starting=false
    @Published private(set) var running=false
    @Published private(set) var connections:[JSONValue]=[]
    @Published var network="tailscale" {
        didSet {
            guard let choice=connections.first(where:{$0["network"].string==network}) else{return}
            code=choice["code"].string
            if !updating{UserDefaults.standard.set(network,forKey:"companionNetwork")}
        }
    }
    var address:String{connections.first(where:{$0["network"].string==network})?["url"].string ?? ""}
    private var api:SuiteAPI?
    private var task:Task<Void,Never>?
    private var generation=0
    private var updating=false

    func start(service:URL,profile:URL) {
        guard !starting else{return}
        if api?.baseURL==service && running{return}
        stop();starting=true;error=nil
        let client=SuiteAPI(baseURL:service),ticket=generation
        api=client
        task=Task { [weak self] in
            guard let self else{return}
            do {
                try await client.connect()
                let state=try await client.post("/api/companion",.object(["enabled":.bool(true)]))
                guard ticket==self.generation else{return}
                self.received(state);UserDefaults.standard.set(true,forKey:"companionEnabled")
                while !Task.isCancelled {
                    try await Task.sleep(for:.seconds(5))
                    let state=try await client.get("/api/companion")
                    guard ticket==self.generation else{return}
                    self.received(state)
                }
            }catch {
                guard ticket==self.generation,!Task.isCancelled else{return}
                self.starting=false;self.running=false;self.error=error.localizedDescription
            }
        }
    }
    private func received(_ value:JSONValue){
        running=value["running"].bool;starting=false
        error=value["error"].string.nonempty
        connections=value["connections"].array
        let preferred=UserDefaults.standard.string(forKey:"companionNetwork") ?? "tailscale"
        updating=true
        network=connections.first(where:{$0["network"].string==preferred})?["network"].string ?? connections.first?["network"].string ?? preferred
        updating=false
        code=connections.first(where:{$0["network"].string==network})?["code"].string ?? ""
        name=value["name"].string
    }
    func disable(){
        guard let api,!starting else{return};starting=true
        Task { [weak self] in
            do {
                let value=try await api.post("/api/companion",.object(["enabled":.bool(false)]))
                self?.stop();self?.received(value);UserDefaults.standard.set(false,forKey:"companionEnabled")
            }catch{self?.starting=false;self?.error=error.localizedDescription}
        }
    }
    // Sharing's socket belongs to the Mac service. Closing this view/model
    // cannot leave a detached listener or erase the user's sharing preference.
    func stop(){generation+=1;task?.cancel();task=nil;api=nil;code="";connections=[];running=false;starting=false;error=nil}
    deinit{task?.cancel()}
}

struct CompanionSettingsView:View {
    @EnvironmentObject var model:SuiteModel
    @ObservedObject var host:CompanionHost
    var body:some View {
        Form {
            Section("iPhone and iPad"){
                Text("View your games, manage the bot and prepare trades from your devices.").foregroundStyle(.secondary)
                if !host.running {
                    Button("Enable Companion"){if let api=model.api{host.start(service:api.baseURL,profile:model.profile)}}.disabled(model.api==nil || host.starting)
                    if host.starting{ProgressView("Starting…")}
                }else{
                    LabeledContent("Host",value:host.name)
                    Picker("Network",selection:$host.network){
                        ForEach(host.connections.indices,id: \.self){index in
                            let connection=host.connections[index]
                            Text(connection["network"].string=="tailscale" ? "Tailscale" : "Local network").tag(connection["network"].string)
                        }
                    }
                    LabeledContent("Address"){Text(host.address).textSelection(.enabled)}
                    HStack{Button("Copy Connection Code"){NSPasteboard.general.clearContents();NSPasteboard.general.setString(host.code,forType:.string)};Button("Stop Sharing"){host.disable()}.disabled(host.starting)}
                    Text(host.network=="tailscale" ? "Paste this code in the mobile app. Keep this Mac awake and Tailscale connected on both devices." : "Paste this code in the mobile app. Keep this Mac awake and both devices on the same local network.").font(.callout).foregroundStyle(.secondary)
                    if !host.connections.contains(where:{$0["network"].string=="tailscale"}) {
                        Text("Connect Tailscale on this Mac for access over cellular. Available connections update automatically.").font(.callout).foregroundStyle(.secondary)
                    }
                }
                if let error=host.error{Text(error).foregroundStyle(.secondary)}
            }
        }.formStyle(.grouped)
    }
}
