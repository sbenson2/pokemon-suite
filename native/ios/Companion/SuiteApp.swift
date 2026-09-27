import SwiftUI
import SuiteCore

@main struct SuiteCompanionApp: App {
    @StateObject private var model=SuiteModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene { WindowGroup { CompanionRoot().environmentObject(model).task {await model.launch()}.onChange(of:scenePhase){_,phase in model.sceneActive(phase == .active)} } }
}

struct CompanionRoot: View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @AppStorage("appearance") private var appearance="system"
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        Group {
            if model.pairing==nil { NavigationStack { ConnectionView() } }
            else if sizeClass == .regular {
                NavigationSplitView {
                    List(selection: Binding<SuitePage?>(get: {model.page}, set: {if let value=$0 {model.page=value}})) { ForEach(SuitePage.allCases) {page in
                        Button {model.page=page} label:{Label(page.companionTitle,systemImage:page.symbol)}.tag(page)
                    }.listRowBackground(GamePalette(dark:scheme == .dark).panel)}
                        .scrollContentBackground(.hidden).background(GamePalette(dark:scheme == .dark).canvas)
                        .navigationTitle("Pokémon Suite").navigationSplitViewColumnWidth(min:180,ideal:210,max:270)
                } detail:{NavigationStack{destination(model.page)}}
            } else {
                NavigationStack{destination(model.page)}
                    .frame(maxWidth:.infinity,maxHeight:.infinity).clipped()
            }
        }
        .background(GamePalette(dark:scheme == .dark).canvas.ignoresSafeArea())
        .preferredColorScheme(appearance=="light" ? .light:appearance=="dark" ? .dark:nil)
        .onChange(of:model.page){_,_ in model.syncPlayback()}
        .sheet(isPresented:$model.showSettings){NavigationStack{ConnectionView()}}
        .sheet(isPresented:Binding(get:{model.reportURL != nil},set:{if !$0{model.reportURL=nil}})){if let url=model.reportURL{ShareLink(item:url).padding(40).presentationDetents([.medium])}}
        .alert("Action couldn’t finish",isPresented:Binding(get:{model.error != nil},set:{if !$0{model.error=nil}})){Button("OK"){model.error=nil}}message:{Text(model.error ?? "")}
    }
    @ViewBuilder func destination(_ page:SuitePage)->some View {
        VStack(spacing:4) {
            SuiteHeader()
            if model.starting && model.games.isEmpty {ProgressView("Connecting to Mac…").frame(maxWidth:.infinity,maxHeight:.infinity)}
            else if model.games.isEmpty {
                ContentUnavailableView {Label("Mac unavailable",systemImage:"desktopcomputer")} description:{Text(model.connectionIssue ?? "Keep Pokémon Suite open on your Mac and Tailscale connected on both devices. Cellular data works with the Tailscale connection.")} actions:{Button("Connection Settings"){model.showSettings=true}}
            } else {
                if page == .live {LiveView(playback:model.playback)}
                else {
                    GamePanel(title:page.companionTitle,symbol:page.symbol,contentPadding:4) {
                        pageContent(page).frame(maxWidth:.infinity,maxHeight:.infinity)
                            .scrollContentBackground(.hidden)
                            .disabled(!model.connected)
                    }.padding(.horizontal,8).padding(.bottom,4)
                }
            }
            if !model.connected && !model.games.isEmpty {Label("Reconnecting to Mac…",systemImage:"wifi.slash").font(.callout).frame(maxWidth:.infinity).padding(10).background(.bar)}
            if let notice=model.notice,model.connected {HStack{Text(notice).font(.callout);Spacer();Button{model.notice=nil}label:{Image(systemName:"xmark")}.accessibilityLabel("Dismiss message")}.padding(12).background(.bar)}
        }
        .background(GamePalette(dark:scheme == .dark).canvas)
        .tint(GamePalette(dark:scheme == .dark).focus)
        .foregroundStyle(GamePalette(dark:scheme == .dark).text)
        .clipped()
        .navigationTitle(page.companionTitle).navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden,for:.navigationBar)
    }
    @ViewBuilder private func pageContent(_ page:SuitePage)->some View {
        switch page {
        case .library:LibraryView()
        case .live:LiveView(playback:model.playback)
        case .pokedex:PokedexView()
        case .farming:FarmingView()
        case .trading:TradingView()
        case .bot:BotView()
        }
    }
}

struct ConnectionView:View {
    @EnvironmentObject var model:SuiteModel
    @Environment(\.dismiss) private var dismiss
    @AppStorage("appearance") private var appearance="system"
    @State private var code=""
    var body:some View {
        Form {
            if let pairing=model.pairing {
                Section("Mac") {
                    Label(pairing.name,systemImage:"desktopcomputer").font(.headline)
                    LabeledContent("Connection",value:model.connected ? "Connected":"Reconnecting")
                    if let issue=model.connectionIssue{Text(issue).font(.callout).foregroundStyle(.secondary)}
                    Text("Use Tailscale on both devices for cellular access. The Mac must stay awake.").font(.footnote).foregroundStyle(.secondary)
                    Text("Games, saves and trades run on this Mac.").font(.footnote).foregroundStyle(.secondary)
                    Button("Reconnect"){Task{await model.connect(pairing)}}
                    Button("Disconnect",role:.destructive){model.disconnect()}
                }
            } else {
                Section {
                    Image(systemName:"desktopcomputer").font(.system(size:52)).foregroundStyle(.tint).frame(maxWidth:.infinity).padding(.vertical,16)
                    Text("Connect to your Mac").font(.title2.weight(.semibold))
                    Text("In Pokémon Suite on your Mac, open Settings → Companion and copy its connection code.").foregroundStyle(.secondary)
                    TextField("Connection code",text:$code,axis:.vertical).textInputAutocapitalization(.never).autocorrectionDisabled().lineLimit(3...5)
                    PasteButton(payloadType:String.self){values in code=values.first ?? ""}
                    Button("Connect"){model.connectCode(code)}.buttonStyle(.borderedProminent).disabled(code.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty || model.starting)
                }
            }
        }.navigationTitle(model.pairing==nil ? "Pokémon Suite":"Mac connection")
        .toolbar{if model.pairing != nil {ToolbarItem(placement:.confirmationAction){Button("Done"){dismiss()}}}}
    }
}

extension JSONValue {
    var gameID:String{self["id"].text}
    var label:String{self["name"].string.nonempty ?? self["label"].string.nonempty ?? self["id"].text}
}
struct BorderedScroll<Content:View>:View {
    @ViewBuilder var content:Content
    @Environment(\.colorScheme) private var scheme
    var body:some View {
        let p=GamePalette(dark:scheme == .dark)
        ScrollView{content.padding(16).frame(maxWidth:.infinity,alignment:.leading)}
            .scrollIndicators(.visible).scrollBounceBehavior(.basedOnSize).scrollDismissesKeyboard(.interactively)
            .background(p.inset).clipShape(GameWindow(corner:4))
            .overlay{GameWindow(corner:4).stroke(p.menuEdge.opacity(0.5),lineWidth:0.7).allowsHitTesting(false)}
    }
}
struct SectionTabs:View {
    let label:String;let items:[String];@Binding var selection:String
    var body:some View{Picker(label,selection:$selection){ForEach(items,id:\.self){Text($0).tag($0)}}.pickerStyle(.segmented).labelsHidden().padding(12)}
}
struct Panel<Content:View>:View {let title:String;@ViewBuilder var content:Content;var body:some View{GamePanel(title:title){VStack(alignment:.leading,spacing:12){content}.frame(maxWidth:.infinity,alignment:.leading)}}}
struct SuiteSplit<Leading:View,Trailing:View>:View {
    let leadingFraction:CGFloat;@ViewBuilder var leading:Leading;@ViewBuilder var trailing:Trailing
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var showingActivity=false
    @Environment(\.dynamicTypeSize) private var typeSize
    var body:some View {
        GeometryReader { geometry in
            let wide = sizeClass == .regular && geometry.size.width >= 800 && !typeSize.isAccessibilitySize
            Group {
                if wide {HStack(spacing:0){leading.frame(width:geometry.size.width*leadingFraction);Divider();trailing.frame(maxWidth:.infinity)}}
                else {VStack(spacing:0){leading;Button("Plan and Queue",systemImage:"list.bullet.rectangle"){showingActivity=true}.frame(maxWidth:.infinity,minHeight:44).background(.bar)}}
            }
            .sheet(isPresented:Binding(get:{!wide && showingActivity},set:{if !wide{showingActivity=$0}})) {
                NavigationStack{trailing.navigationTitle("Hunt activity").navigationBarTitleDisplayMode(.inline).toolbar{ToolbarItem(placement:.confirmationAction){Button("Done"){showingActivity=false}}}}
            }
        }
    }
}
struct InfoButton:View {let title:String;let message:String;@State private var showing=false;var body:some View{Button{showing=true}label:{Image(systemName:"info.circle")}.accessibilityLabel(title).popover(isPresented:$showing){Text(message).padding().presentationCompactAdaptation(.popover)}}}
extension ToggleStyle where Self==SwitchToggleStyle {static var checkbox:SwitchToggleStyle{SwitchToggleStyle()}}
extension View {
    func suiteSheetSize(width:CGFloat,height:CGFloat?=nil)->some View {self.frame(maxWidth:width,maxHeight:height ?? .infinity)}
    func suiteConfigurationPicker()->some View {self.pickerStyle(.menu)}
}
func gameGoal(_ session:JSONValue)->String?{if session["bot"]["runScope"].string == "campaign", let label=session["campaign"]["storyProgress"]["current"]["label"].string.nonempty{return label};let goal=session["bot"]["objective"];return goal.string.nonempty ?? goal["name"].string.nonempty ?? goal["id"].string.nonempty?.replacingOccurrences(of:"-",with:" ").capitalized}
func statName(_ key:String)->String{["hp":"HP","attack":"Attack","defense":"Defense","specialAttack":"Sp. Atk","specialDefense":"Sp. Def","speed":"Speed","special":"Special"][key] ?? key}
