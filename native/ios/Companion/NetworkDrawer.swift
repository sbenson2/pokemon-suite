import SwiftUI
import SuiteCore

struct NetworkDrawer:View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.dismiss) private var dismiss
    @State private var radio:JSONValue = .null
    @State private var loading=false
    @State private var issue:String?
    var body:some View {
        NavigationStack {
            Form {
                Section("Mac connection") {
                    LabeledContent("Mac",value:model.pairing?.name ?? "Not paired")
                    LabeledContent("Status",value:model.connected ? "Connected":"Reconnecting")
                    if let host=model.pairing?.url.host {LabeledContent("Address",value:host)}
                    Text("Keep Tailscale connected on both devices for access away from home.").font(.footnote).foregroundStyle(.secondary)
                    if let issue=model.connectionIssue {Text(issue).font(.callout).foregroundStyle(.secondary)}
                    Button("Reconnect to Mac") {if let pairing=model.pairing {Task {await model.connect(pairing)}}}
                        .disabled(model.starting || model.pairing == nil)
                }
                Section("Trade network") {
                    LabeledContent("Radio",value:!model.connected ? "Mac disconnected":loading ? "Checking…":radio.isNull ? "Not checked":radio["state"].string == "checking" ? "Checking…":radio["ready"].bool ? "Ready":"Unavailable")
                    if let reason=radio["reason"].string.nonempty {Text(reason).font(.callout).foregroundStyle(.secondary)}
                    if let issue {Text(issue).font(.callout).foregroundStyle(.secondary)}
                    let trade=model.session["nativeTrade"]
                    if !model.connected {Text("Trade status unavailable").foregroundStyle(.secondary)}
                    else if let phase=trade["phase"].string.nonempty {LabeledContent("Trade",value:readableGameText(phase))}
                    else {Text("No active trade reported").foregroundStyle(.secondary)}
                    HStack {
                        Button("Check radio") {Task {await refresh(check:true)}}
                            .disabled(loading || !model.connected || model.selectedGame != "firered")
                        Spacer()
                        Button("Open Trading") {model.page = .trading;dismiss()}
                    }
                    Text("The Mac handles the trade. A working Tailscale connection does not mean the trade radio is ready.").font(.footnote).foregroundStyle(.secondary)
                }
            }.navigationTitle("Network and trades").navigationBarTitleDisplayMode(.inline)
                .toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){dismiss()}}}
                .task(id:"\(model.selectedGame)-\(model.connected)"){await refresh(check:false)}
        }
    }
    private func refresh(check:Bool) async {
        let game=model.selectedGame
        radio = .null
        guard let api=model.api,model.connected else {issue="Connect to the Mac to read trade status.";return}
        guard game == "firered" else {radio = .null;issue="Trade radio checks are available for FireRed.";return}
        loading=true;issue=nil
        defer{loading=false}
        do {
            let value = check
                ? try await api.post("/api/pokemon-suite/check-radio",.object(["game":.string(game)]))
                : try await api.get("/api/pokemon-suite/inventory?game=\(game)&source=current")
            guard !Task.isCancelled,game==model.selectedGame else{return}
            radio=value["radio"]
        } catch {
            guard !Task.isCancelled,game==model.selectedGame else{return}
            radio = .null;issue=error.localizedDescription
        }
    }
}
