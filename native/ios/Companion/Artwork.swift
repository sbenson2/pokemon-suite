import SwiftUI
import SceneKit
import SuiteCore

@MainActor enum ArtworkCache {
    static let images=NSCache<NSString,UIImage>()
    static func load(_ path:String,identity:String,api:SuiteAPI?) async->UIImage? {
        guard let api else{return nil};let key=(api.baseURL.absoluteString+identity+path) as NSString
        if let image=images.object(forKey:key){return image}
        guard let data=try? await api.data(path),!Task.isCancelled,data.starts(with:[137,80,78,71,13,10,26,10]),let image=UIImage(data:data) else{return nil}
        images.countLimit=180;images.totalCostLimit=24*1024*1024;images.setObject(image,forKey:key,cost:Int(image.size.width*image.size.height*4));return image
    }
}
struct ROMAsset:View {
    @EnvironmentObject var model:SuiteModel
    var game:String?=nil;let kind:String;let key:String;var shiny=false;var size:CGFloat=48;var fallback="questionmark.square.dashed";var label="Game artwork"
    @State private var image:UIImage?
    private var selected:String{game ?? model.selectedGame}
    private var identity:String{(model.api?.baseURL.absoluteString ?? "")+selected+kind+key+String(shiny)+model.state["artwork"][selected]["fingerprint"].string}
    var body:some View {
        Group{if let image{Image(uiImage:image).resizable().interpolation(.none).scaledToFit().modifier(BadgeColors(game:selected,kind:kind,key:key))}else{Image(systemName:fallback).foregroundStyle(.secondary).font(.system(size:size*0.4))}}
            .frame(width:size,height:size).accessibilityLabel(label)
            .task(id:identity){image=nil;let revision=identity;let result=await ArtworkCache.load("/api/rom-art/\(selected)/\(kind)/\(key).png?shiny=\(shiny ? 1:0)",identity:identity,api:model.api);if revision==identity,!Task.isCancelled{image=result}}
    }
}
struct ROMSprite:View {
    @EnvironmentObject var model:SuiteModel
    let id:Int;var shiny=false;var size:CGFloat=64
    var body:some View{ROMAsset(kind:"pokemon",key:String(id),shiny:shiny,size:size,label:model.species.first{$0["id"].int==id}?["name"].string ?? "Pokémon \(id)")}
}
struct CartridgeView: View {
    @EnvironmentObject var model: SuiteModel
    let game: JSONValue
    var body: some View {
        if let api = model.api {
            CartridgeContent(game: game, artwork: CartridgeArtwork(game: game, artwork: model.state["artwork"]), api: api).equatable()
        }
    }
}

private struct CartridgeContent: View, Equatable {
    let game: JSONValue
    let artwork: CartridgeArtwork
    let api: SuiteAPI
    @State private var image: CGImage?
    @State private var loaded: CartridgeThumbnailKey?
    static func == (a: Self, b: Self) -> Bool { a.game == b.game && a.artwork == b.artwork && a.api === b.api }
    var body: some View {
        GeometryReader { geometry in
            let key = CartridgeThumbnailKey(api: api, game: game, artwork: artwork, width: geometry.size.width, height: geometry.size.height)
            ZStack {
                if loaded == key, let image { Image(decorative: image, scale: 2).resizable().scaledToFit() }
            }.frame(width: geometry.size.width, height: geometry.size.height)
            .task(id: key) {
                do {
                    let result = try await CartridgePreviews.load(key: key, game: game, api: api)
                    try Task.checkCancellation(); image = result.image; loaded = key
                } catch { /* Disappeared cells and disconnected sources retry on appearance. */ }
            }
        }.accessibilityHidden(true).allowsHitTesting(false)
    }
}

private struct CartridgePreview: @unchecked Sendable { let image: CGImage }
private enum CartridgePreviews {
    private static let cache = AsyncResourceCache<CartridgeThumbnailKey, CartridgePreview>(costLimit: 24 * 1024 * 1024, countLimit: 80, concurrency: 1, cost: { $0.image.bytesPerRow * $0.image.height })
    private static let renderer = SCNRenderer(device: MTLCreateSystemDefaultDevice(), options: nil)
    static func load(key: CartridgeThumbnailKey, game: JSONValue, api: SuiteAPI) async throws -> CartridgePreview {
        if let cached = await cache.cachedValue(for: key) { return cached }
        async let artwork = try? ROMArtworkLoader.data(key.artwork.mascot, api: api)
        async let logo = try? ROMArtworkLoader.data(key.artwork.logo, api: api)
        let images = await (artwork, logo)
        try Task.checkCancellation()
        let complete = (key.artwork.mascot == nil || images.0 != nil) && (key.artwork.logo == nil || images.1 != nil)
        let value = try await cache.value(for: key) {
            try autoreleasepool {
                try Task.checkCancellation()
                renderer.scene = CartridgeMesh(game: game, artwork: images.0.flatMap(UIImage.init(data:)), logo: images.1.flatMap(UIImage.init(data:))).makeScene()
                defer { renderer.scene = nil }
                let snapshot = renderer.snapshot(atTime: 0, with: CGSize(width: key.width, height: key.height), antialiasingMode: .multisampling4X)
                guard let image = snapshot.cgImage else { throw SuiteError("Cartridge preview could not be rendered.") }
                return CartridgePreview(image: image)
            }
        }
        if !complete { await cache.removeValue(for: key) }
        return value
    }
}

private struct CartridgeMesh {
    let game: JSONValue
    let artwork: UIImage?
    let logo: UIImage?
    func makeScene()->SCNScene{
        let platform=game["platform"].string,id=game.gameID,wide=platform=="gba",old=["gb","gbc"].contains(platform)
        let w:CGFloat=wide ? 2.25:platform=="switch" ? 1.26:1.72,h:CGFloat=wide ? 1.33:old ? 1.98:1.85,d:CGFloat=wide ? 0.25:old ? 0.23:0.11
        let colors:[String:UInt32]=["red":0xC5383D,"blue":0x2864AF,"yellow":0xEBBE29,"green":0x359764,"gold":0xB89745,"silver":0xA1ACB9,"crystal":0x43A9BC,"ruby":0xA92C40,"sapphire":0x26569D,"emerald":0x238D67,"firered":0xCC4935,"leafgreen":0x79AC40,"diamond":0x73A5D6,"pearl":0xCA92B6,"platinum":0x8E8E97,"heartgold":0xCA9D40,"soulsilver":0x91A9C9,"black":0x454F63,"white":0xD5CAB5,"x":0x2887C4,"y":0xBC3543,"sun":0xDF893A,"moon":0x54629F,"sword":0x299AB5,"shield":0xB54163,"scarlet":0xCA513F,"violet":0x7A62AE]
        let rgb=colors[id] ?? 0x688292,accent=UIColor(red:CGFloat(rgb>>16&255)/255,green:CGFloat(rgb>>8&255)/255,blue:CGFloat(rgb&255)/255,alpha:1)
        let shell=platform=="3ds" ? UIColor(white:0.91,alpha:1):["nds","switch"].contains(platform) ? UIColor(white:0.19,alpha:1):accent
        let scene=SCNScene(),object=SCNNode();scene.rootNode.addChildNode(object)
        func material(_ color:UIColor)->SCNMaterial{let m=SCNMaterial();m.lightingModel = .physicallyBased;m.diffuse.contents=color;m.roughness.contents=0.45;return m}
        let plastic=material(shell),trim=material(shell.withAlphaComponent(1)),path=UIBezierPath()
        let x=w/2,y=h/2
        let points:[CGPoint]
        if wide {points=[CGPoint(x:-x,y:-y),CGPoint(x:-x,y:y-0.09),CGPoint(x:-x+0.16,y:y-0.09),CGPoint(x:-x+0.16,y:y),CGPoint(x:x-0.16,y:y),CGPoint(x:x-0.16,y:y-0.09),CGPoint(x:x,y:y-0.09),CGPoint(x:x,y:-y)]}
        else if platform=="3ds"{points=[CGPoint(x:-x,y:-y),CGPoint(x:-x,y:y),CGPoint(x:x+0.13,y:y),CGPoint(x:x+0.13,y:y-0.19),CGPoint(x:x,y:y-0.19),CGPoint(x:x,y:-y)]}
        else{points=[CGPoint(x:-x,y:-y),CGPoint(x:-x,y:y),CGPoint(x:x-0.18,y:y),CGPoint(x:x,y:y-0.18),CGPoint(x:x,y:-y)]}
        path.move(to:points[0]);for point in points.dropFirst(){path.addLine(to:point)};path.close()
        let shape=SCNShape(path:path,extrusionDepth:d);shape.chamferRadius=0.018;shape.materials=[plastic];object.addChildNode(SCNNode(geometry:shape))
        func piece(_ width:CGFloat,_ height:CGFloat,_ depth:CGFloat,_ px:CGFloat,_ py:CGFloat,_ pz:CGFloat,_ mat:SCNMaterial){let b=SCNBox(width:width,height:height,length:depth,chamferRadius:min(0.009,depth/2));b.materials=[mat];let n=SCNNode(geometry:b);n.position=SCNVector3(Float(px),Float(py),Float(pz));object.addChildNode(n)}
        let lw=w*(wide ? 0.82:0.8),lh=h*(wide ? 0.65:old ? 0.66:0.78),ly:CGFloat=wide ? -0.05:old ? -0.17:0.01
        piece(lw+0.06,lh+0.06,0.02,0,ly,d/2+0.017,trim)
        let label=SCNPlane(width:lw,height:lh);label.cornerRadius=0.028;let printMaterial=SCNMaterial();printMaterial.lightingModel = .constant;printMaterial.diffuse.contents=labelImage(accent:accent,wide:wide,ratio:lh/lw);label.materials=[printMaterial]
        let labelNode=SCNNode(geometry:label);labelNode.position=SCNVector3(0,Float(ly),Float(d/2+0.04));object.addChildNode(labelNode)
        if wide{for side:CGFloat in [-1,1]{for n in 0..<5{piece(0.066,0.018,0.018,side*(x-0.062),y-0.24-CGFloat(n)*0.055,d/2+0.017,trim)}};piece(w-0.05,0.07,0.07,0,y-0.045,d/2,plastic)}
        else if old{for n in 0..<4{piece(w-0.16,0.024,0.022,0,y-0.12-CGFloat(n)*0.046,d/2+0.02,plastic)}}
        let gold=material(UIColor(red:0.7,green:0.6,blue:0.32,alpha:1));gold.metalness.contents=0.75
        for n in 0..<24{piece(w*0.46/24,0.15,0.018,(CGFloat(n)-11.5)*w*0.66/24,-y+0.065,-d/2-0.023,gold)}
        object.eulerAngles=SCNVector3(0.13,-0.27,-0.035)
        let camera=SCNNode();camera.camera=SCNCamera();camera.camera?.usesOrthographicProjection=true;camera.camera?.orthographicScale=1.32;camera.position=SCNVector3(0,0,7);scene.rootNode.addChildNode(camera)
        let ambient=SCNNode();ambient.light=SCNLight();ambient.light?.type = .ambient;ambient.light?.intensity=300;scene.rootNode.addChildNode(ambient)
        let key=SCNNode();key.light=SCNLight();key.light?.type = .omni;key.light?.intensity=650;key.position=SCNVector3(-3,4,5);scene.rootNode.addChildNode(key)
        return scene
    }
    func labelImage(accent:UIColor,wide:Bool,ratio:CGFloat)->UIImage{
        let size=CGSize(width:600,height:600*ratio)
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size:size, format:format).image{context in
            let rect=CGRect(origin:.zero,size:size);UIColor.white.setFill();context.fill(rect);accent.withAlphaComponent(0.35).setFill();context.fill(rect)
            func draw(_ image:UIImage,_ box:CGRect){let scale=min(box.width/image.size.width,box.height/image.size.height);let target=CGRect(x:box.midX-image.size.width*scale/2,y:box.midY-image.size.height*scale/2,width:image.size.width*scale,height:image.size.height*scale);context.cgContext.interpolationQuality = .none;image.draw(in:target)}
            func text(_ value:String,_ box:CGRect,_ fontSize:CGFloat){let paragraph=NSMutableParagraphStyle();paragraph.alignment = .center;(value as NSString).draw(in:box,withAttributes:[.font:UIFont.systemFont(ofSize:fontSize,weight:.heavy),.foregroundColor:UIColor(red:0.09,green:0.13,blue:0.19,alpha:1),.paragraphStyle:paragraph])}
            if let logo{draw(logo,CGRect(x:42,y:12,width:516,height:size.height*0.25))}else{text("Pokémon",CGRect(x:20,y:10,width:560,height:size.height*0.25),56)}
            let title=game["label"].string.nonempty ?? game["title"].string.replacingOccurrences(of:"Pokémon ",with:"")
            if let artwork{draw(artwork,CGRect(x:60,y:size.height*0.29,width:480,height:size.height*0.45))}
            text(title,CGRect(x:20,y:size.height*0.78,width:560,height:size.height*0.2),title.count>14 ? 34:42)
        }
    }
}
