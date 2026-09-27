import SwiftUI
import SuiteCore

struct ROMRegionMap {
    let region: String
    let x: Int
    let y: Int
    var title: String { ["kanto":"Kanto","sevii-123":"Sevii Islands · 1–3","sevii-45":"Sevii Islands · 4–5","sevii-67":"Sevii Islands · 6–7"][region] ?? region }
}
struct LocationMapSnapshot {
    let name: String
    let map: ROMRegionMap?
    let head: String?
    let position: String?
    let lastKnown: Bool
    init(session: JSONValue, game: String, connected: Bool, now: Date = .now) {
        let p = ActivityPresentation(session: session, now: now)
        name = p.location ?? "Location unavailable"
        let sameGame = session["game"].string == game
        let observed = session["spectator"]["map"]["townMap"]
        if sameGame, ["firered","leafgreen"].contains(game),
           ["kanto","sevii-123","sevii-45","sevii-67"].contains(observed["region"].string),
           let x=observed["x"].finiteNumber,let y=observed["y"].finiteNumber,
           x.rounded()==x,y.rounded()==y,x>=0,x<22,y>=0,y<15 {
            map=ROMRegionMap(region:observed["region"].string,x:Int(x),y:Int(y))
        } else {map=nil}
        head=sameGame ? TrainerCharacter(gender:session["spectator"]["trainer"]["gender"]).key : nil
        let point = session["observation"]["position"].isNull ? session["position"] : session["observation"]["position"]
        if sameGame, let x = point["x"].finiteNumber, let y = point["y"].finiteNumber, x >= 0, y >= 0, x < 10000, y < 10000 {
            position = "\(Int(x)), \(Int(y))"
        } else { position = nil }
        lastKnown = !connected || p.stale || ["offline", "closed"].contains(session["state"].string)
    }
}

struct LiveLocationPanel: View {
    @EnvironmentObject var model: SuiteModel
    var compact = false
    @State private var details = false
    @State private var summaryHeight:CGFloat=188
    var body: some View {
        TimelineView(.periodic(from: .now, by: 2)) { context in
            let location = LocationMapSnapshot(session: model.session, game: model.selectedGame, connected: model.connected, now: context.date)
            GamePanel(title: "Location", compact: compact) {
                VStack(alignment:.leading,spacing:0) {
                if details {
                    VStack(alignment:.leading,spacing:4) {
                        Button{details=false}label:{
                            HStack{Text("Back to map");Spacer(minLength:0);Image(systemName:"chevron.up")}
                                .font(compact ? .system(size:11,weight:.semibold):.callout.weight(.semibold))
                                .frame(maxWidth:.infinity,minHeight:44).contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("location-detail-toggle")
                        ScrollView {
                            VStack(alignment:.leading,spacing:8) {
                                locationFact("Location",location.name)
                                if let map=location.map {locationFact("Region",map.title)}
                                if let point=location.position {locationFact("Tile",point)}
                                locationFact("Updated",location.lastKnown ? "Last known location":"Current location")
                                RegionalMap(location:location).frame(height:compact ? 86:160)
                            }.frame(maxWidth:.infinity,alignment:.leading)
                        }.scrollIndicators(.visible).accessibilityIdentifier("location-detail-facts")
                    }.frame(height:compact ? 116:summaryHeight,alignment:.top)
                } else {
                Button { details = true } label: {
                    VStack(spacing: 4) {
                        RegionalMap(location: location).frame(height: compact ? 86 : 160)
                        Text(location.name).font(compact ? .system(size: 11, weight: .medium) : .callout.weight(.medium))
                            .lineLimit(compact ? 2 : nil).frame(maxWidth: .infinity, alignment: .leading)
                    }.frame(maxWidth: .infinity, minHeight: compact ? 116 : nil, maxHeight: compact ? 116 : nil)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityLabel("Location map, \(location.name)")
                    .accessibilityValue(location.lastKnown ? "Last known location" : "Current location")
                    .accessibilityHint("Show region and tile coordinates inside this card")
                    .accessibilityIdentifier("location-detail-toggle")
                }
                }.background{GeometryReader{g in
                    Color.clear.onAppear{if !details {summaryHeight=g.size.height}}
                        .onChange(of:g.size.height){_,height in if !details && height > 0 {summaryHeight=height}}
                }}
            }
        }.accessibilityElement(children: .contain).accessibilityIdentifier("live-location-map")
            .onChange(of:model.selectedGame){_,_ in details=false}
    }
    private func locationFact(_ label:String,_ value:String)->some View {
        VStack(alignment:.leading,spacing:2){Text(label).foregroundStyle(.secondary);Text(value).monospacedDigit()}
            .font(compact ? .system(size:11):.callout).accessibilityElement(children:.combine)
    }
}

private struct RegionalMap: View {
    @EnvironmentObject var model: SuiteModel
    let location: LocationMapSnapshot
    @State private var artwork: LoadedMap?
    @State private var loading = false
    private struct LoadedMap { let identity: String; let map: UIImage; let head: UIImage? }
    private var identity: String {
        [model.api?.baseURL.absoluteString ?? "",model.selectedGame,model.state["artwork"][model.selectedGame]["fingerprint"].string,location.map?.region ?? "",location.head ?? ""].joined(separator:"|")
    }
    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let map = location.map, let artwork, artwork.identity == identity {
                GeometryReader { g in
                    let scale = min(g.size.width / 240, g.size.height / 160)
                    ZStack(alignment: .topLeading) {
                        Image(uiImage: artwork.map).resizable().interpolation(.none).frame(width:240*scale,height:160*scale)
                        if let head = artwork.head {
                            Image(uiImage: head).resizable().interpolation(.none).frame(width:16*scale,height:16*scale)
                                .position(x:CGFloat(8*map.x+36)*scale,y:CGFloat(8*map.y+36)*scale)
                        }
                    }.frame(width:240*scale,height:160*scale)
                        .position(x:g.size.width/2,y:g.size.height/2)
                }.accessibilityElement(children:.ignore).accessibilityIdentifier("rom-town-map")
                    .accessibilityLabel("Town Map")
                    .accessibilityValue("\(location.head == "female" ? "Female trainer" : location.head == "male" ? "Male trainer" : "Trainer unavailable"), \(location.name)")
            } else {
                VStack(spacing: 6) {
                    if loading { ProgressView() } else { Image(systemName:"map").font(.title3) }
                    Text(loading ? "Loading map…" : "Map unavailable").font(.caption)
                }.foregroundStyle(.secondary).frame(maxWidth:.infinity,maxHeight:.infinity)
            }
            if location.lastKnown {
                Image(systemName:"clock.fill").font(.caption).padding(4).background(.black.opacity(0.65),in:Circle()).foregroundStyle(.white).padding(3)
            }
        }.background(Color.black).clipShape(GameWindow(corner:3))
            .overlay { GameWindow(corner:3).stroke(.secondary.opacity(0.4),lineWidth:1) }
            .task(id:identity) {
                artwork=nil
                guard let region=location.map?.region else {loading=false;return}
                loading=true
                let revision=identity,game=model.selectedGame,api=model.api,head=location.head
                async let background=ArtworkCache.load("/api/rom-art/\(game)/map/\(region).png",identity:revision,api:api)
                let marker:UIImage?
                if let head {marker=await ArtworkCache.load("/api/rom-art/\(game)/map/\(head).png",identity:revision,api:api)} else {marker=nil}
                let image=await background
                guard !Task.isCancelled,revision==identity else{return}
                loading=false
                if let image {artwork=LoadedMap(identity:revision,map:image,head:marker)}
            }
    }
}
