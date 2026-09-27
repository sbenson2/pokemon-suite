import AppKit
import SceneKit
import SuiteCore

struct CartridgeStyle {
    let id: String
    let title: String
    let platform: String
    let shell: NSColor
    let ink: NSColor
    let accent: NSColor
    var wide: Bool { platform == "gba" }
    var width: CGFloat { wide ? 2.25 : platform == "switch" ? 1.26 : platform == "3ds" ? 1.78 : 1.72 }
    var height: CGFloat { wide ? 1.33 : platform == "switch" ? 1.85 : platform == "nds" || platform == "3ds" ? 1.85 : 1.98 }
    var depth: CGFloat { wide ? 0.25 : platform == "gb" || platform == "gbc" ? 0.23 : platform == "nds" ? 0.15 : platform == "3ds" ? 0.17 : 0.16 }
    var labelWidth: CGFloat { width * (wide ? 0.82 : platform == "switch" ? 0.86 : 0.80) }
    var labelHeight: CGFloat { height * (wide ? 0.65 : platform == "gb" || platform == "gbc" ? 0.66 : 0.78) }
    var labelY: CGFloat { wide ? -0.05 : platform == "gb" || platform == "gbc" ? -0.17 : 0.01 }
    var platformName: String { ["gb":"GAME BOY", "gbc":"GAME BOY COLOR", "gba":"GAME BOY ADVANCE", "nds":"Nintendo DS", "3ds":"Nintendo 3DS", "switch":"Nintendo Switch"][platform] ?? platform.uppercased() }
    static let compatibleMascots = ["red":6,"blue":9,"yellow":25,"green":3,"gold":250,"silver":249,
        "lets-go-pikachu":25,"lets-go-eevee":133]
    init(game: JSONValue) {
        id = game["id"].string; title = game["label"].string.nonempty ?? game["title"].string.replacingOccurrences(of: "Pokémon ", with: "")
        platform = game["platform"].string
        let hues: [String: UInt32] = ["red":0xC5383D,"blue":0x2864AF,"yellow":0xEBBE29,"green":0x359764,
            "gold":0xB89745,"silver":0xA1ACB9,"crystal":0x43A9BC,"ruby":0xA92C40,"sapphire":0x26569D,
            "emerald":0x238D67,"firered":0xCC4935,"leafgreen":0x79AC40,"diamond":0x73A5D6,"pearl":0xCA92B6,
            "platinum":0x8E8E97,"heartgold":0xCA9D40,"soulsilver":0x91A9C9,"black":0x454F63,"white":0xD5CAB5,
            "black2":0x2878A0,"white2":0xC77C44,"x":0x2887C4,"y":0xBC3543,"omega-ruby":0xAE3A30,
            "alpha-sapphire":0x3765AB,"sun":0xDF893A,"moon":0x54629F,"ultra-sun":0xD79F32,"ultra-moon":0x738ED6,
            "lets-go-pikachu":0xD8A93C,"lets-go-eevee":0xAE8551,"sword":0x299AB5,"shield":0xB54163,
            "brilliant-diamond":0x5598C1,"shining-pearl":0xB47CAB,"legends-arceus":0x768E8C,"scarlet":0xCA513F,
            "violet":0x7A62AE,"legends-za":0x338678]
        accent = NSColor(rgb: hues[id] ?? 0x688292)
        shell = platform == "3ds" ? NSColor(rgb:0xE9E8E1) : platform == "nds" || platform == "switch" ? NSColor(rgb:0x303237) : accent
        ink = NSColor(rgb:0x172130)
    }
}

private extension NSColor {
    convenience init(rgb: UInt32) { self.init(srgbRed: CGFloat(rgb >> 16 & 255)/255, green: CGFloat(rgb >> 8 & 255)/255, blue: CGFloat(rgb & 255)/255, alpha: 1) }
}

enum CartridgeMesh {
    static func material(_ color: NSColor, roughness: CGFloat = 0.48, metal: CGFloat = 0) -> SCNMaterial {
        let m = SCNMaterial(); m.lightingModel = .physicallyBased
        m.diffuse.contents = color.usingColorSpace(NSColorSpace(cgColorSpace:CGColorSpace(name:CGColorSpace.extendedLinearSRGB)!)!) ?? color
        m.roughness.contents = roughness; m.metalness.contents = metal; return m
    }
    static func shape(_ s: CartridgeStyle) -> NSBezierPath {
        let w=s.width/2, h=s.height/2
        let p=NSBezierPath(); p.flatness=0.001
        if s.id == "crystal" {
            p.move(to:CGPoint(x:-w,y:-h));p.line(to:CGPoint(x:-w,y:h-0.11))
            p.curve(to:CGPoint(x:w,y:h-0.11),controlPoint1:CGPoint(x:-w*0.65,y:h+0.09),controlPoint2:CGPoint(x:w*0.65,y:h+0.09))
            p.line(to:CGPoint(x:w,y:-h));p.close();return p
        }
        let points: [CGPoint]
        switch s.platform {
        case "gba": points = [CGPoint(x:-w,y:-h+0.03),CGPoint(x:-w,y:h-0.09),CGPoint(x:-w+0.16,y:h-0.09),CGPoint(x:-w+0.16,y:h),CGPoint(x:w-0.16,y:h),CGPoint(x:w-0.16,y:h-0.09),CGPoint(x:w,y:h-0.09),CGPoint(x:w,y:-h+0.03),CGPoint(x:w-0.035,y:-h),CGPoint(x:-w+0.035,y:-h)]
        case "3ds": points = [CGPoint(x:-w,y:-h),CGPoint(x:-w,y:h-0.04),CGPoint(x:-w+0.04,y:h),CGPoint(x:w+0.13,y:h),CGPoint(x:w+0.13,y:h-0.19),CGPoint(x:w,y:h-0.19),CGPoint(x:w,y:-h),CGPoint(x:-w,y:-h)]
        case "nds": points = [CGPoint(x:-w,y:-h),CGPoint(x:-w,y:h),CGPoint(x:w-0.18,y:h),CGPoint(x:w,y:h-0.18),CGPoint(x:w,y:-h)]
        case "switch": points = [CGPoint(x:-w,y:-h),CGPoint(x:-w,y:h),CGPoint(x:w-0.11,y:h),CGPoint(x:w,y:h-0.11),CGPoint(x:w,y:-h)]
        default: points = [CGPoint(x:-w,y:-h),CGPoint(x:-w,y:h-0.09),CGPoint(x:-w+0.085,y:h),CGPoint(x:w-0.21,y:h),CGPoint(x:w-0.21,y:h-0.16),CGPoint(x:w,y:h-0.16),CGPoint(x:w,y:-h)]
        }
        p.move(to:points[0]); for point in points.dropFirst() { p.line(to:point) }; p.close(); return p
    }
    static func scene(style s: CartridgeStyle, artwork: NSImage?, logo: NSImage?) -> SCNScene {
        let scene=SCNScene(); let object=SCNNode(); object.name="cartridge"; scene.rootNode.addChildNode(object)
        let plastic=material(s.shell, roughness:0.38)
        let trim=material(s.shell.blended(withFraction:0.18,of:.black) ?? s.shell,roughness:0.52)
        let recess=material(NSColor(rgb:0x1D2228),roughness:0.75)
        func piece(_ w:CGFloat,_ h:CGFloat,_ d:CGFloat,_ x:CGFloat,_ y:CGFloat,_ z:CGFloat,_ m:SCNMaterial,_ radius:CGFloat=0.012) {
            let b=SCNBox(width:w,height:h,length:d,chamferRadius:min(radius,d/2));b.materials=[m]
            let n=SCNNode(geometry:b);n.position=SCNVector3(x,y,z);object.addChildNode(n)
        }
        let imported = CartridgeModels.node(for: s)
        if let imported { object.addChildNode(imported) }
        if imported == nil {
        let outline=shape(s)
        let body=SCNShape(path:outline,extrusionDepth:s.depth);body.chamferRadius=0.018;body.materials=[plastic]
        object.addChildNode(SCNNode(geometry:body))
        let seam=SCNShape(path:outline,extrusionDepth:0.012);seam.materials=[trim]
        let seamNode=SCNNode(geometry:seam);seamNode.scale=SCNVector3(1.002,1.002,1);object.addChildNode(seamNode)
        }
        let z=s.depth/2+0.007
        piece(s.labelWidth+0.065,s.labelHeight+0.065,0.02,0,s.labelY,z,trim,0.015)
        let label=SCNPlane(width:s.labelWidth,height:s.labelHeight);label.cornerRadius=0.028
        let printMaterial=material(.white,roughness:0.58)
        printMaterial.lightingModel = .constant
        printMaterial.diffuse.contents=labelImage(s,artwork:artwork,logo:logo); printMaterial.diffuse.magnificationFilter = .linear
        label.materials=[printMaterial];let labelNode=SCNNode(geometry:label);labelNode.position=SCNVector3(0,s.labelY,z+0.012);object.addChildNode(labelNode)
        // Molded grip rails, lips, recessed connector and rear contact fingers.
        if imported == nil {
        if s.platform=="gba" {
            piece(s.width-0.05,0.07,0.07,0,s.height/2-0.045,z-0.012,plastic)
            for side:CGFloat in [-1,1] { for rib in 0..<5 { piece(0.066,0.018,0.018,side*(s.width/2-0.062),s.height/2-0.24-CGFloat(rib)*0.055,z,trim) } }
        } else if s.platform=="gb" || s.platform=="gbc" {
            for rib in 0..<4 { piece(s.width-0.16,0.024,0.022,0,s.height/2-0.12-CGFloat(rib)*0.046,z,plastic) }
            for side:CGFloat in [-1,1] { piece(0.033,s.height*0.6,0.028,side*(s.width/2-0.05),-0.11,z,trim) }
        } else {
            piece(s.width-0.1,0.035,0.018,0,-s.height/2+0.10,z,trim)
            for side:CGFloat in [-1,1] { piece(0.025,s.height*0.7,0.018,side*(s.width/2-0.055),-0.07,z,trim) }
        }
        }
        if ["gb","gbc","gba"].contains(s.platform) {
            let name=SCNPlane(width:s.width*0.72,height:0.085)
            let lettering=SCNMaterial();lettering.lightingModel = .constant
            lettering.diffuse.contents=NSImage(size:NSSize(width:768,height:64),flipped:false) { rect in
                let paragraph=NSMutableParagraphStyle();paragraph.alignment = .center
                let font=NSFont.systemFont(ofSize:43,weight:.heavy)
                (s.platformName as NSString).draw(in:rect.offsetBy(dx:0,dy:-2),withAttributes:[.font:font,.paragraphStyle:paragraph,.foregroundColor:NSColor.white.withAlphaComponent(0.24)])
                (s.platformName as NSString).draw(in:rect,withAttributes:[.font:font,.paragraphStyle:paragraph,.foregroundColor:NSColor.black.withAlphaComponent(0.32)])
                return true
            }
            name.materials=[lettering];let textNode=SCNNode(geometry:name)
            textNode.position=SCNVector3(0,s.height/2-(s.wide ? 0.175:0.30),(s.id == "crystal" ? 0.165 : z+0.013));object.addChildNode(textNode)
        }
        if imported == nil {
        piece(s.width*0.73,0.22,0.022,0,-s.height/2+0.075,-s.depth/2-0.008,recess)
        let gold=material(NSColor(rgb:0xB49A51),roughness:0.3,metal:0.75)
        let contacts=s.platform=="switch" ? 17: s.platform=="nds" || s.platform=="3ds" ? 17:24
        for n in 0..<contacts { let x=(CGFloat(n)-CGFloat(contacts-1)/2)*s.width*0.66/CGFloat(contacts);piece(s.width*0.46/CGFloat(contacts),0.15,0.018,x,-s.height/2+0.065,-s.depth/2-0.023,gold) }
        }
        let camera=SCNNode(); camera.camera=SCNCamera();camera.camera?.usesOrthographicProjection=true;camera.camera?.orthographicScale=1.40;camera.camera?.zNear=0.1;camera.camera?.zFar=30;camera.position=SCNVector3(0,0,7);scene.rootNode.addChildNode(camera)
        let ambient=SCNNode();ambient.light=SCNLight();ambient.light?.type = .ambient;ambient.light?.color=NSColor(white:0.9,alpha:1);ambient.light?.intensity=100;scene.rootNode.addChildNode(ambient)
        let key=SCNNode();key.light=SCNLight();key.light?.type = .omni;key.light?.intensity=220;key.position=SCNVector3(-3,4,5);scene.rootNode.addChildNode(key)
        let fill=SCNNode();fill.light=SCNLight();fill.light?.type = .omni;fill.light?.intensity=60;fill.position=SCNVector3(3,-1,2);scene.rootNode.addChildNode(fill)
        // Soft contact shadow texture is original procedural shading.
        let shadow=SCNPlane(width:2.2,height:0.30);let sm=SCNMaterial();sm.lightingModel = .constant
        sm.diffuse.contents=shadowImage();sm.writesToDepthBuffer=false;shadow.materials=[sm]
        let shadowNode=SCNNode(geometry:shadow);shadowNode.position=SCNVector3(0,-1.12,-0.4);scene.rootNode.addChildNode(shadowNode)
        object.eulerAngles=SCNVector3(0.13,-0.27,-0.035)
        return scene
    }
    static func shadowImage() -> NSImage {
        let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:256,pixelsHigh:64,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
        for y in 0..<64 { for x in 0..<256 {
            let dx=(Double(x)-127.5)/70,dy=(Double(y)-31.5)/17
            let offset=y*bitmap.bytesPerRow+x*4
            bitmap.bitmapData![offset]=0;bitmap.bitmapData![offset+1]=0;bitmap.bitmapData![offset+2]=0
            bitmap.bitmapData![offset+3]=UInt8(48 * exp(-2*(dx*dx+dy*dy)))
        } }
        let image=NSImage(size:NSSize(width:256,height:64));image.addRepresentation(bitmap);return image
    }
    static func labelImage(_ s:CartridgeStyle, artwork:NSImage?, logo:NSImage?) -> NSImage {
        let w:CGFloat=768,h:CGFloat=768*s.labelHeight/s.labelWidth
        return NSImage(size:NSSize(width:w,height:h),flipped:false) { rect in
            let pale=s.accent.blended(withFraction:0.83,of:.white) ?? .white
            NSGradient(starting:pale,ending:s.accent.blended(withFraction:0.3,of:.white)!)!.draw(in:rect,angle:-60)
            // Quiet guilloche-like print lines, clipped to the physical label.
            NSColor.white.withAlphaComponent(0.2).setStroke()
            for i in 0..<13 { let path=NSBezierPath(ovalIn:NSRect(x:w*0.16-CGFloat(i)*30,y:h*0.2-CGFloat(i)*30,width:w*0.6+CGFloat(i)*60,height:w*0.6+CGFloat(i)*60));path.lineWidth=1.4;path.stroke() }
            func text(_ text:String,_ r:NSRect,_ size:CGFloat,_ weight:NSFont.Weight,_ color:NSColor) {
                let p=NSMutableParagraphStyle();p.alignment = .center;p.lineBreakMode = .byWordWrapping
                (text as NSString).draw(in:r,withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:weight),.foregroundColor:color,.paragraphStyle:p])
            }
            if s.wide {
                if let logo { draw(logo,in:NSRect(x:w*0.045,y:h*0.50,width:w*0.55,height:h*0.36)) }
                else { text("Pokémon",NSRect(x:w*0.04,y:h*0.53,width:w*0.53,height:h*0.26),62,.heavy,s.ink) }
                text(s.title,NSRect(x:w*0.045,y:h*0.17,width:w*0.55,height:h*0.25),s.title.count>7 ? 49:57,.heavy,s.ink)
                if let artwork { draw(artwork,in:NSRect(x:w*0.60,y:h*0.10,width:w*0.36,height:h*0.82),pixelated:true) }
                return true
            }
            let modern=["nds","3ds","switch"].contains(s.platform)
            let top=modern ? h*0.11:0
            if modern {
                (s.platform=="switch" ? NSColor(rgb:0xD93636):NSColor.white.withAlphaComponent(0.92)).setFill();NSRect(x:0,y:h-top,width:w,height:top).fill()
                text(s.platformName,NSRect(x:8,y:h-top+top*0.1,width:w-16,height:top*0.8),top*0.52,.semibold,s.platform=="switch" ? .white:s.ink)
            }
            let logoH=h*(s.wide ? 0.27:0.19),logoY=h-top-logoH-h*0.035
            if let logo { draw(logo,in:NSRect(x:w*0.09,y:logoY,width:w*0.82,height:logoH)) }
            else { text("Pokémon",NSRect(x:w*0.05,y:logoY,width:w*0.90,height:logoH),min(logoH*0.8, w*0.15),.heavy,s.ink) }
            let titleH=h*(s.wide ? 0.21:0.17)
            let version=s.title.replacingOccurrences(of:" (Japan)",with:"")
            let size=min(s.wide ? 66:70,version.count>15 ? 43:version.count>10 ? 52:70)
            text(version,NSRect(x:w*0.05,y:h*0.055,width:w*0.90,height:titleH),CGFloat(size),.heavy,s.ink)
            if let artwork {
                draw(artwork,in:NSRect(x:w*0.12,y:h*0.08+titleH,width:w*0.76,height:max(10,logoY-h*0.10-titleH)),pixelated:true)
            } else {
                let words=version.replacingOccurrences(of:"Legends: ",with:"").split(separator:" ")
                let initial=words.map { String($0.prefix(1)) }.prefix(2).joined()
                text(initial,NSRect(x:w*0.09,y:h*0.28,width:w*0.82,height:h*0.34),h*0.26,.black,s.accent.blended(withFraction:0.35,of:.black)!)
            }
            NSColor.black.withAlphaComponent(0.12).setStroke();let border=NSBezierPath(rect:rect.insetBy(dx:2,dy:2));border.lineWidth=3;border.stroke()
            return true
        }
    }
    static func draw(_ image:NSImage,in box:NSRect,pixelated:Bool=false) {
        // Trim transparent sprite padding without changing the source pixels.
        var source=NSRect(origin:.zero,size:image.size)
        if pixelated,let data=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:data) {
            var l=bitmap.pixelsWide,r=0,b=bitmap.pixelsHigh,t=0
            for y in 0..<bitmap.pixelsHigh { for x in 0..<bitmap.pixelsWide { if (bitmap.colorAt(x:x,y:y)?.alphaComponent ?? 0)>0.01 { l=min(l,x);r=max(r,x+1);b=min(b,y);t=max(t,y+1) } } }
            if r>l && t>b { source=NSRect(x:CGFloat(l),y:CGFloat(bitmap.pixelsHigh-t),width:CGFloat(r-l),height:CGFloat(t-b)) }
        }
        let factor=min(box.width/source.width,box.height/source.height)
        let dest=NSRect(x:box.midX-source.width*factor/2,y:box.midY-source.height*factor/2,width:source.width*factor,height:source.height*factor)
        NSGraphicsContext.current?.imageInterpolation = pixelated ? .none:.high
        image.draw(in:dest,from:source,operation:.sourceOver,fraction:1)
    }
}
