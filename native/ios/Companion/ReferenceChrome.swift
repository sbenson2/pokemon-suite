import SwiftUI
import SuiteCore

struct SuiteHeader:View {
    @EnvironmentObject var model:SuiteModel
    @State private var network=false
    var body:some View {
        GeometryReader { geometry in
            ZStack {
                HStack {
                    SuiteMenu()
                    Spacer(minLength:0)
                    Button{network=true}label:{Image(systemName:model.connected ? "wifi":"wifi.slash").font(.system(size:20))}
                        .buttonStyle(GameRoundButtonStyle()).accessibilityLabel("Network and trades")
                        .accessibilityValue(model.connected ? "Mac connected":"Mac disconnected")
                }.padding(.horizontal,10)
                SuiteWordmark(width:min(176,geometry.size.width*0.48))
            }.frame(maxWidth:.infinity,maxHeight:.infinity)
                .overlay(alignment:.bottom){HeaderSeam().stroke(Color(hex:0x535C66).opacity(0.55),lineWidth:0.7).frame(height:10).allowsHitTesting(false)}
        }.frame(height:74).accessibilityElement(children:.contain).accessibilityIdentifier("suite-header")
            .sheet(isPresented:$network){NetworkDrawer().presentationDetents([.medium,.large]).presentationDragIndicator(.visible)}
    }
}

/// Navigation stays on the Poké Ball; the centered wordmark is not a control.
struct SuiteMenu:View {
    @EnvironmentObject var model:SuiteModel
    @State private var showing=false
    @AppStorage("appearance") private var appearance="system"
    private let pages:[SuitePage]=[.library,.live,.trading,.pokedex,.farming,.bot]
    var body:some View {
        Button{showing=true} label:{
            SpinningPokeball(isOpen:showing).frame(width:44,height:44).allowsHitTesting(false).accessibilityHidden(true)
                .contentShape(Rectangle())
        }.buttonStyle(.plain)
            .accessibilityLabel("Game menu")
            .accessibilityValue("\(showing ? "Open":"Closed"), \(model.page.rawValue)").accessibilityHint("Open Pokémon Suite navigation and game options")
            .accessibilityIdentifier("suite-menu")
            .popover(isPresented:$showing,attachmentAnchor:.rect(.bounds),arrowEdge:.top) {
                ScrollView {
                    VStack(alignment:.leading,spacing:0) {
                        ForEach(pages){page in
                            Button{showing=false;model.page=page}label:{
                                HStack(spacing:12){
                                    Image(systemName:page.symbol).frame(width:24)
                                    Text(page.companionTitle).frame(maxWidth:.infinity,alignment:.leading)
                                    if model.page == page {Image(systemName:"checkmark").font(.callout.weight(.semibold))}
                                }.frame(minHeight:44).contentShape(Rectangle())
                            }.accessibilityIdentifier("suite-destination-\(page.id)")
                        }
                        Divider().padding(.vertical,8)
                        Picker("Selected game",selection:Binding(get:{model.selectedGame},set:model.selectGame)) {
                            ForEach(model.games,id:\.gameID){Text($0["title"].string).tag($0.gameID)}
                        }.pickerStyle(.menu).frame(minHeight:44).disabled(model.busy)
                        Button("Save Game",systemImage:"square.and.arrow.down"){showing=false;model.saveGame()}
                            .frame(minHeight:44).disabled(!model.connected || !model.gameRunning || model.busy)
                        Button(model.gameRunning ? "Stop Game" : "Start Game", systemImage:model.gameRunning ? "stop.fill":"play.fill") {
                            showing=false
                            if model.gameRunning {model.stopGame()} else {model.startGame()}
                        }.frame(minHeight:44).disabled(!model.connected || model.busy || !model.installed)
                        LiveAudioMenu(playback:model.playback).frame(minHeight:44)
                        Divider().padding(.vertical,8)
                        Picker("Appearance",selection:$appearance){Text("System").tag("system");Text("Light").tag("light");Text("Dark").tag("dark")}
                            .pickerStyle(.menu).frame(minHeight:44)
                    }.padding(16)
                }.scrollBounceBehavior(.basedOnSize).frame(width:280,height:528)
                    .presentationCompactAdaptation(.popover)
                    .buttonStyle(.plain).tint(.primary)
            }
    }
}

private struct SuiteWordmark:View {
    @EnvironmentObject var model:SuiteModel
    let width:CGFloat
    private var gameTitle:String {model.game["label"].string.nonempty ?? model.game["title"].string.replacingOccurrences(of:"Pokémon ",with:"")}
    var body:some View {
        VStack(spacing:0){
            ROMWordmark().frame(width:width,height:42)
            Text(gameTitle).textCase(.uppercase).font(.system(size:16,weight:.black,design:.monospaced)).tracking(1)
                .foregroundStyle(LinearGradient(colors:[Color(hex:0xFFCE7F),Color(hex:0xFB6845)],startPoint:.top,endPoint:.bottom))
                .shadow(color:Color(hex:0x751D15),radius:0,x:0,y:1).lineLimit(1).minimumScaleFactor(0.75)
            Text("COMPANION").tracking(4).font(.system(size:7,weight:.bold)).foregroundStyle(.secondary)
        }.frame(width:width,height:68).allowsHitTesting(false)
            .accessibilityElement(children:.ignore).accessibilityLabel("Pokémon Suite, \(gameTitle)").accessibilityIdentifier("suite-wordmark")
    }
}

extension SuitePage {
    var companionTitle:String {
        switch self {case .farming:"Hunting";case .bot:"Bot Settings";default:rawValue}
    }
}

private struct LiveAudioMenu:View {
    @ObservedObject var playback:GamePlayback
    var body:some View {Button(playback.sound ? "Mute":"Enable sound",systemImage:playback.sound ? "speaker.slash":"speaker.wave.2"){playback.toggleSound()}}
}

private struct ROMWordmark:View {
    @EnvironmentObject var model:SuiteModel
    @State private var image:UIImage?
    private var resource:ROMArtworkResource?{CartridgeArtwork(game:model.game,artwork:model.state["artwork"]).logo}
    private var identity:String{(model.api?.baseURL.absoluteString ?? "")+(resource?.path ?? "")+(resource?.fingerprint ?? "")}
    var body:some View {
        Group {
            if let image{Image(uiImage:image).resizable().interpolation(.none).scaledToFit()}
            else{Text("Pokémon").font(.system(size:29,weight:.black,design:.rounded)).foregroundStyle(Color(hex:0xFFCF43)).shadow(color:Color(hex:0x28559D),radius:0,x:1,y:2)}
        }.task(id:identity){
            image=nil
            guard let api=model.api else{return}
            let request=identity
            if let data=try? await ROMArtworkLoader.data(resource,api:api),request==identity,!Task.isCancelled {image=UIImage(data:data)}
        }
    }
}

private struct HeaderSeam:Shape {
    func path(in r:CGRect)->Path {
        Path{p in
            for reflected in [false,true] {
                func point(_ x:CGFloat,_ y:CGFloat)->CGPoint{CGPoint(x:reflected ? r.width-x:x,y:y)}
                p.move(to:point(0,0));p.addLine(to:point(r.width*0.18,0));p.addLine(to:point(r.width*0.2,5));p.addLine(to:point(r.width*0.3,5));p.addLine(to:point(r.width*0.32,9))
                p.move(to:point(0,4));p.addLine(to:point(r.width*0.17,4));p.addLine(to:point(r.width*0.19,9));p.addLine(to:point(r.width*0.33,9))
            }
        }
    }
}

struct GameRoundButtonStyle:ButtonStyle {
    func makeBody(configuration:Configuration)->some View {
        configuration.label.frame(width:40,height:40)
            .foregroundStyle(Color(hex:0xF2F3F6))
            .background(LinearGradient(colors:[Color(hex:0x3D444E),Color(hex:0x171E28),Color(hex:0x343D48)],startPoint:.topLeading,endPoint:.bottomTrailing),in:Circle())
            .overlay{Circle().strokeBorder(Color(hex:0x8F969E).opacity(configuration.isPressed ? 1:0.7),lineWidth:0.8)}
            .brightness(configuration.isPressed ? 0.12:0).frame(width:44,height:44)
    }
}
