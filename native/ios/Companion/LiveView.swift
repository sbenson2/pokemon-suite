import SwiftUI
import SuiteCore

struct LiveView: View {
    @EnvironmentObject var model: SuiteModel
    let playback: GamePlayback
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var scheme
    private var palette:GamePalette{GamePalette(dark:scheme == .dark)}
    private var ratio:CGFloat{["gb","gbc"].contains(model.game["platform"].string) ? 160.0/144.0:1.5}
    var body:some View {
        GeometryReader{g in
            let wide=(g.size.width >= 900 || (g.size.width >= 650 && g.size.width > g.size.height)) && !typeSize.isAccessibilitySize
            Group {
                if wide {
                    HStack(alignment:.top,spacing:12){
                        screen.frame(maxWidth:.infinity,maxHeight:.infinity)
                        dashboard(width:max(390,g.size.width*0.40),height:g.size.height-4).frame(width:max(390,g.size.width*0.40))
                    }.padding(.horizontal,10).padding(.bottom,4)
                } else {
                    VStack(spacing:6){
                        screen.frame(height:min((g.size.width-16)/ratio+8,g.size.height*0.46)).padding(.horizontal,8)
                        dashboard(width:g.size.width-16,height:g.size.height-min((g.size.width-16)/ratio+8,g.size.height*0.46)-10).padding(.horizontal,8)
                    }.padding(.bottom,4)
                }
            }.frame(width:g.size.width,height:g.size.height)
        }.background(palette.canvas).tint(palette.focus)
            .onAppear{model.syncPlayback()}.onDisappear{playback.releaseInput()}
    }
    private var screen:some View {GameViewport(playback:playback)}
    private func dashboard(width:CGFloat,height:CGFloat)->some View {
        ScrollViewReader {proxy in
        ScrollView {
            if width >= 365 && typeSize <= .large && !model.manual {
                ReferenceDashboard(width:width-4,availableHeight:height).padding(2)
            } else {
            VStack(spacing:10) {
                let paired=width >= 365 && typeSize <= .xxxLarge
                if paired {HStack(alignment:.top,spacing:10){TrainerPanel();LiveLocationPanel()}}
                else {TrainerPanel();LiveLocationPanel()}
                if model.manual {GamePanel(title:"Manual play",symbol:"gamecontroller"){RemoteController(playback:playback)}}
                PartyPanel(onInspect:{proxy.scrollTo("team-panel",anchor:.top)}).id("team-panel")
                LiveSessionPanel()
            }.padding(8).frame(maxWidth:.infinity)
            }
        }.scrollIndicators(.visible).scrollBounceBehavior(.basedOnSize)
            .background(palette.inset)
            .overlay{RoundedRectangle(cornerRadius:8).stroke(palette.edge.opacity(0.25),lineWidth:0.5).allowsHitTesting(false)}
            .accessibilityIdentifier("live-dashboard")
        }
    }
}

private struct GameViewport:View {
    @EnvironmentObject var model:SuiteModel
    @ObservedObject var playback:GamePlayback
    @Environment(\.colorScheme) private var scheme
    private var palette:GamePalette{GamePalette(dark:scheme == .dark)}
    private var ratio:CGFloat {
        if let image=playback.image{return CGFloat(image.width)/CGFloat(image.height)}
        return ["gb","gbc"].contains(model.game["platform"].string) ? 160.0/144.0:1.5
    }
    var body:some View {
        ZStack {
            Color.black
            if let image=playback.image {Image(decorative:image,scale:1).resizable().interpolation(.none).scaledToFit()}
            else{VStack(spacing:12){Image(systemName:"gamecontroller").font(.largeTitle);Text(!model.connected ? "Reconnecting to Mac…":model.session.isNull ? "Connecting to the game…":model.gameRunning ? playback.message:"Game stopped").font(.callout).multilineTextAlignment(.center)}.foregroundStyle(.white.opacity(0.8)).padding()}
        }.aspectRatio(ratio,contentMode:.fit).padding(4)
            .background(palette.inset,in:GameWindow(corner:3))
            .overlay{GameWindow(corner:3).stroke(palette.metal,lineWidth:1.5).allowsHitTesting(false)}
            .overlay{GameWindow(corner:2).stroke(palette.edge.opacity(0.4),lineWidth:0.6).padding(2).allowsHitTesting(false)}
            .accessibilityElement(children:.ignore).accessibilityLabel("Live game screen")
            .accessibilityValue("\(playback.frameCount) frames").accessibilityIdentifier("live-screen")
    }
}
struct TrainerPanel:View {
    @EnvironmentObject var model:SuiteModel
    var compact=false
    @State private var details=false
    @State private var summaryHeight:CGFloat=180
    private var trainer:JSONValue{model.session["spectator"]["trainer"]}
    private var badges:[JSONValue]{model.session["spectator"]["badges"].array}
    private var character:TrainerCharacter{TrainerCharacter(gender:trainer["gender"])}
    var body:some View {
        GamePanel(title:"Trainer",compact:compact) {
            VStack(alignment:.leading,spacing:0) {
            if details {inlineDetails}
            else if compact {compactContent}
            else {
            Button{details=true}label:{
                HStack(spacing:6){
                    TrainerPortrait(character:character,size:48).accessibilityHidden(true)
                    Text(trainer["name"].string.nonempty ?? "Trainer").font(.headline).frame(maxWidth:.infinity,alignment:.leading)
                    Image(systemName:"chevron.right").font(.caption2).foregroundStyle(.secondary)
                }.frame(minHeight:48).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Trainer details, \(trainer["name"].text)").accessibilityValue(character.label).accessibilityIdentifier("trainer-detail-toggle")
            VStack(spacing:6){
                TrainerFact(label:"Money",value:trainer["money"].isNull ? "—":trainer["money"].int.formatted())
                TrainerFact(label:"Caught",value:trainer["pokedex"]["owned"].text)
            }.padding(.top,6)
            if !badges.isEmpty {
                Divider().padding(.vertical,7)
                LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:2),count:8),spacing:6){
                    ForEach(Array(badges.enumerated()),id:\.offset){index,badge in
                        ROMAsset(kind:"badges",key:String(index),size:16,fallback:"seal",label:"\(badge["label"].string), \(badge["earned"].bool ? "earned":"not earned")")
                            .saturation(badge["earned"].bool ? 1:0)
                            .opacity(badge["earned"].bool ? 1:0.28)
                    }
                }.accessibilityLabel("Badge case")
            }
            }
            }.background{GeometryReader{g in
                Color.clear.onAppear{if !details {summaryHeight=g.size.height}}
                    .onChange(of:g.size.height){_,height in if !details && height > 0 {summaryHeight=height}}
            }}
        }.accessibilityElement(children:.contain).accessibilityIdentifier("trainer-panel")
            .onChange(of:model.selectedGame){_,_ in details=false}
    }
    private var inlineDetails:some View {
        VStack(alignment:.leading,spacing:4) {
            Button{details=false}label:{
                HStack{Text("Back to trainer");Spacer(minLength:0);Image(systemName:"chevron.up")}
                    .font(compact ? .system(size:11,weight:.semibold):.callout.weight(.semibold))
                    .frame(maxWidth:.infinity,minHeight:44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("trainer-detail-toggle")
            ScrollView {
                VStack(alignment:.leading,spacing:8) {
                    trainerDetail("Name",trainer["name"].text)
                    if !trainer["id"].isNull {trainerDetail("Trainer ID",trainer["id"].text)}
                    trainerDetail("Money",trainer["money"].isNull ? "—":"₽ \(trainer["money"].int.formatted())")
                    trainerDetail("Caught",trainer["pokedex"]["owned"].text)
                    trainerDetail("Seen",trainer["pokedex"]["seen"].text)
                    ForEach(Array(badges.enumerated()),id:\.offset){_,badge in
                        trainerDetail(badge["label"].text,badge["earned"].bool ? "Earned":"Not earned")
                    }
                }.frame(maxWidth:.infinity,alignment:.leading)
            }.scrollIndicators(.visible).accessibilityIdentifier("trainer-detail-facts")
        }.frame(height:compact ? 116:summaryHeight,alignment:.top)
    }
    private func trainerDetail(_ label:String,_ value:String)->some View {
        VStack(alignment:.leading,spacing:2){Text(label).foregroundStyle(.secondary);Text(value).monospacedDigit()}
            .font(compact ? .system(size:11):.callout).accessibilityElement(children:.combine)
    }
    private var compactContent:some View {
        VStack(spacing:4){
            Button{details=true}label:{
                HStack(spacing:4){
                    TrainerPortrait(character:character,size:88).frame(width:61,height:86).accessibilityHidden(true)
                    VStack(alignment:.leading,spacing:3){
                        Text(trainer["name"].string.nonempty ?? "Trainer").font(.system(size:15,weight:.black,design:.monospaced)).lineLimit(1)
                        HStack(spacing:2){ForEach(0..<min(6,model.session["spectator"]["party"].array.count),id:\.self){_ in ROMAsset(kind:"item",key:"4",size:11,fallback:"circle.fill").accessibilityHidden(true)}}
                        Rectangle().fill(.secondary.opacity(0.35)).frame(height:0.5)
                        compactFact("Money",trainer["money"].isNull ? "—":"₽ \(trainer["money"].int.formatted())")
                        compactFact("Caught",trainer["pokedex"]["owned"].text)
                    }.frame(maxWidth:.infinity,alignment:.leading)
                }.frame(height:86).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityLabel("Trainer details, \(trainer["name"].text)").accessibilityValue(character.label).accessibilityIdentifier("trainer-detail-toggle")
            Rectangle().fill(.secondary.opacity(0.35)).frame(height:0.5)
            HStack(spacing:0){ForEach(Array(badges.prefix(8).enumerated()),id:\.offset){index,badge in
                ROMAsset(kind:"badges",key:String(index),size:20,fallback:"seal",label:"\(badge["label"].string), \(badge["earned"].bool ? "earned":"not earned")")
                    .saturation(badge["earned"].bool ? 1:0)
                    .opacity(badge["earned"].bool ? 1:0.25).frame(maxWidth:.infinity)
            }}.frame(height:20).accessibilityLabel("Badge case")
        }.frame(height:116)
    }
    private func compactFact(_ label:String,_ value:String)->some View {
        HStack(spacing:2){Text(label).foregroundStyle(.secondary);Spacer(minLength:0);Text(value).monospacedDigit()}.font(.system(size:11)).lineLimit(1)
    }
}
private struct TrainerFact:View {
    let label:String;let value:String
    var body:some View{ViewThatFits(in:.horizontal){HStack{Text(label).foregroundStyle(.secondary);Spacer(minLength:4);Text(value).monospacedDigit()}.fixedSize(horizontal:true,vertical:false);VStack(alignment:.leading){Text(label).foregroundStyle(.secondary);Text(value)}}.font(.caption)}
}
struct PartyPanel:View {
    @EnvironmentObject var model:SuiteModel
    var compact=false
    var contentHeight:CGFloat = 207
    var onInspect:()->Void = {}
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var inspection=PartyInspection()
    @State private var gridSize:CGSize = .zero
    @State private var inspectionHeight:CGFloat?
    private var party:[JSONValue]{Array(model.session["spectator"]["party"].array.prefix(6))}
    private var roster:PartyInspection.Roster{.init(party:party,game:model.selectedGame,session:model.session["sessionId"].string)}
    private var selected:Int?{inspection.index(in:roster)}
    private var battler:JSONValue{model.session["mode"].string=="battle" && model.connected && !ActivityPresentation(session:model.session,now:Date()).stale ? model.session["spectator"]["strategy"]["battle"]["player"]:.null}
    var body:some View {
        GamePanel(title:"Team",compact:compact) {
            let columns=compact ? Array(repeating:GridItem(.flexible(),spacing:5,alignment:.top),count:2):[GridItem(.adaptive(minimum:typeSize > .xxLarge ? 280:145),spacing:8,alignment:.top)]
            ZStack {
            if selected == nil {
            LazyVGrid(columns:columns,alignment:.leading,spacing:compact ? 6:8) {
                ForEach(0..<6,id:\.self){index in
                    if index < party.count {
                        let p=PartyMemberPresentation(member:party[index],index:index,battler:battler)
                        Button{
                            inspectionHeight=gridSize.height > 0 ? gridSize.height:nil
                            withAnimation(transitionAnimation){inspection.toggle(index,in:roster);onInspect()}
                        }label:{PartyTile(p:p,compact:compact,tileHeight:compact ? (contentHeight-12)/3:65)}.buttonStyle(.plain)
                            .accessibilityIdentifier("party-slot-\(index)")
                            .accessibilityLabel("\(index+1). \(p.shiny ? "Shiny ":"")\(p.name), level \(p.level.map(String.init) ?? "unknown"), \(p.hp.map(String.init) ?? "unknown") of \(p.maxHP.map(String.init) ?? "unknown") HP\(p.status.map{", \($0)"} ?? "")")
                            .accessibilityHint("Show details inside the Team panel")
                    } else {
                        HStack{Image(systemName:"circle.dashed");Text("Empty slot \(index+1)").font(compact ? .system(size:10):.caption)}.foregroundStyle(.secondary).frame(maxWidth:.infinity,minHeight:compact ? (contentHeight-12)/3:72).overlay{RoundedRectangle(cornerRadius:6).stroke(.secondary.opacity(0.2),style:StrokeStyle(lineWidth:1,dash:[3]))}
                    }
                }
            }.transition(.opacity)
            } else {
                // Preserve geometry without retaining invisible accessible buttons.
                Color.clear.frame(height:inspectionHeight).accessibilityHidden(true)
            }
            }.frame(height:selected == nil ? nil:inspectionHeight,alignment:.top)
                .background{GeometryReader{g in Color.clear.preference(key:PartyGridSize.self,value:g.size)}}
                .overlay {
                    if let index=selected {
                        PartyInlineDetails(p:PartyMemberPresentation(member:party[index],index:index,battler:battler),member:party[index],compact:compact,close:close)
                            .transition(reduceMotion ? .opacity:.opacity.combined(with:.scale(scale:0.98)))
                    }
                }
                .clipped()
                .onPreferenceChange(PartyGridSize.self){size in
                    guard size.width > 0,size.height > 0 else{return}
                    if gridSize.width > 0,abs(gridSize.width-size.width) > 1 {inspection.close()}
                    gridSize=size
                }
        }.accessibilityElement(children:.contain).accessibilityIdentifier("team-panel")
            .onChange(of:roster){_,current in inspection.reconcile(with:current)}
            .onChange(of:typeSize){_,_ in inspection.close()}
            .onChange(of:compact){_,_ in inspection.close()}
            .onChange(of:contentHeight){_,_ in inspection.close()}
    }
    private var transitionAnimation:Animation{.easeInOut(duration:reduceMotion ? 0.12:0.22)}
    private func close(){withAnimation(transitionAnimation){inspection.close()}}
}
private struct PartyGridSize:PreferenceKey {
    static var defaultValue:CGSize = .zero
    static func reduce(value:inout CGSize,nextValue:()->CGSize){value=nextValue()}
}
private struct PartyTile:View {
    let p:PartyMemberPresentation
    var compact=false
    var tileHeight:CGFloat = 65
    @Environment(\.colorScheme) private var scheme
    private var palette:GamePalette{GamePalette(dark:scheme == .dark)}
    private var health:Color{Color(hex:(p.hpRatio ?? 1) <= 0.2 ? 0xEF5A4A:(p.hpRatio ?? 1) <= 0.5 ? 0xCEAD4A:0x52CE52)}
    var body:some View {
        if compact {compactContent}
        else {
        VStack(alignment:.leading,spacing:6){
            HStack(alignment:.center,spacing:6){
                if let id=p.speciesID{ROMSprite(id:id,shiny:p.shiny,size:42).accessibilityHidden(true)}else{Image(systemName:"questionmark.square.dashed").frame(width:42,height:42).foregroundStyle(.secondary)}
                VStack(alignment:.leading,spacing:3){
                    Text(p.name).font(.subheadline.weight(.medium)).fixedSize(horizontal:false,vertical:true)
                    HStack(spacing:4){Text("Lv. \(p.level.map(String.init) ?? "—")");if let gender=p.gender{Text(gender)};if p.shiny{Image(systemName:"sparkles").accessibilityLabel("Shiny")}}
                        .font(.caption).foregroundStyle(palette.secondary)
                }.frame(maxWidth:.infinity,alignment:.leading)
            }
            GameMeter(value:p.hpRatio,color:health,label:"Health",reading:"\(p.hp.map(String.init) ?? "—") of \(p.maxHP.map(String.init) ?? "—")")
            HStack(alignment:.firstTextBaseline,spacing:3){
                Text("\(p.hp.map(String.init) ?? "—") / \(p.maxHP.map(String.init) ?? "—") HP").monospacedDigit()
                Spacer(minLength:0)
                if p.active{Image(systemName:"arrowtriangle.right.fill").accessibilityLabel("Active battler")}
                if p.heldItem != nil{Image(systemName:"shippingbox").accessibilityLabel("Holding an item")}
            }.font(.caption2).foregroundStyle(palette.secondary)
            if let status=p.status{Text(status).font(.caption.weight(.medium)).foregroundStyle(health)}
            if let xp=p.experienceRatio{GameMeter(value:xp,color:palette.focus,label:"Experience",reading:p.experienceRemaining.map{"\($0) to next level"} ?? "Progress to next level",height:3)}
        }.padding(9).frame(maxWidth:.infinity,alignment:.leading)
            .background(palette.inset,in:RoundedRectangle(cornerRadius:6))
            .overlay{RoundedRectangle(cornerRadius:6).stroke(p.active ? palette.focus:palette.edge.opacity(0.5),lineWidth:p.active ? 2:1)}
        }
    }
    private var compactContent:some View {
        HStack(spacing:2){
            if let id=p.speciesID{ROMSprite(id:id,shiny:p.shiny,size:44).accessibilityHidden(true)}else{Image(systemName:"questionmark.square.dashed").frame(width:44).foregroundStyle(.secondary)}
            VStack(alignment:.leading,spacing:2){
                Text(p.name).font(.system(size:11,weight:.medium)).lineLimit(2).minimumScaleFactor(0.85)
                HStack(spacing:2){Text("Lv. \(p.level.map(String.init) ?? "—")");if let gender=p.gender{Text(gender).foregroundStyle(gender == "♂" ? palette.focus:.pink)};if p.shiny{Image(systemName:"sparkles")};if p.status != nil{Circle().fill(.orange).frame(width:4,height:4)}}.font(.system(size:9.5)).foregroundStyle(palette.secondary)
                GameMeter(value:p.hpRatio,color:health,label:"Health",reading:"\(p.hp.map(String.init) ?? "—") of \(p.maxHP.map(String.init) ?? "—")",height:4)
                Text("\(p.hp.map(String.init) ?? "—")/\(p.maxHP.map(String.init) ?? "—")").font(.system(size:10)).monospacedDigit()
                if let xp=p.experienceRatio{GameMeter(value:xp,color:palette.focus,label:"Experience",reading:p.experienceRemaining.map{"\($0) to next level"} ?? "Progress to next level",height:1.5)}
            }.frame(maxWidth:.infinity,alignment:.leading)
        }.padding(.horizontal,4).frame(height:tileHeight)
            .background(LinearGradient(colors:[p.slot==0 ? palette.dialogue.opacity(0.4):palette.inset,palette.panel],startPoint:.topLeading,endPoint:.bottomTrailing),in:RoundedRectangle(cornerRadius:6))
            .overlay{RoundedRectangle(cornerRadius:6).strokeBorder(p.slot==0 ? palette.focus:palette.edge.opacity(0.6),lineWidth:p.slot==0 ? 1.5:1)}
            .overlay{GameWindow(corner:2).stroke(palette.menuEdge.opacity(p.slot==0 ? 0.5:0.18),lineWidth:0.5).padding(2).allowsHitTesting(false)}
            .overlay(alignment:.leading){if p.slot==0{Image(systemName:"arrowtriangle.right.fill").font(.system(size:6)).foregroundStyle(palette.focus).offset(x:1).accessibilityLabel("Party lead")}}
            .shadow(color:p.slot==0 ? palette.focus.opacity(0.15):.clear,radius:3)
    }
}
struct RemoteController:View{
    @ObservedObject var playback:GamePlayback
    @State private var held=Set<String>()
    func key(_ text:String,_ value:String)->some View{Text(text).font(.headline).frame(minWidth:48,minHeight:46).frame(maxWidth:.infinity).background(.quaternary,in:RoundedRectangle(cornerRadius:10)).contentShape(Rectangle()).gesture(DragGesture(minimumDistance:0).onChanged{_ in held.insert(value);playback.input(Array(held).sorted())}.onEnded{_ in held.remove(value);playback.input(Array(held).sorted())}).accessibilityLabel(value.capitalized).accessibilityAddTraits(.isButton).accessibilityAction{playback.input([value]);DispatchQueue.main.asyncAfter(deadline:.now()+0.12){playback.releaseInput()}}}
    var body:some View{VStack(spacing:8){HStack{key("L","l");Spacer(minLength:90);key("R","r")};HStack{VStack(spacing:4){key("↑","up");HStack(spacing:4){key("←","left");key("↓","down");key("→","right")}};Spacer(minLength:16);key("B","b");key("A","a")};HStack{key("Select","select");key("Start","start")}}.onDisappear{held=[];playback.releaseInput()}}
}
