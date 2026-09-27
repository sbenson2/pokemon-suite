import SwiftUI

/// Native metal framing drawn in code; game artwork remains ROM-sourced.
struct GamePalette {
    let dark: Bool
    var canvas:Color{Color(hex:dark ? 0x080F17:0xE4EBF0)}
    var panel:Color{Color(hex:dark ? 0x14212C:0xF7F9FA)}
    var inset:Color{Color(hex:dark ? 0x0B131B:0xEAF0F4)}
    var edge:Color{Color(hex:dark ? 0x777E85:0x687D8F)}
    var text:Color{Color(hex:dark ? 0xF1F3EF:0x172938)}
    var secondary:Color{Color(hex:dark ? 0xB4C1CD:0x485F71)}
    var focus:Color{Color(hex:dark ? 0x53AEFF:0x0064AD)}
    // The FireRed textbox's slate-blue and warm rim, adapted for native chrome.
    var dialogue:Color{Color(hex:0x29526B)}
    var menuEdge:Color{Color(hex:dark ? 0xB6C9C9:0x526D76)}
    var ivory:Color{Color(hex:0xE7DEE7)}
    var metal:LinearGradient{LinearGradient(stops:[.init(color:Color(hex:0x353D46),location:0),.init(color:Color(hex:0xB7B8B5),location:0.08),.init(color:Color(hex:0x505860),location:0.18),.init(color:Color(hex:0x9A9C9C),location:0.48),.init(color:Color(hex:0x4E565D),location:0.68),.init(color:Color(hex:0xA6AAA9),location:0.94),.init(color:Color(hex:0x363E46),location:1)],startPoint:.topLeading,endPoint:.bottomTrailing)}
}
extension Color {
    init(hex:UInt32){self.init(.sRGB,red:Double(hex>>16&255)/255,green:Double(hex>>8&255)/255,blue:Double(hex&255)/255,opacity:1)}
}
struct GameWindow:Shape {
    var corner:CGFloat=7
    func path(in r:CGRect)->Path{
        let c=min(corner,min(r.width,r.height)/3)
        return Path{p in
            let s=max(0.5,c/2)
            p.move(to:CGPoint(x:r.minX+c,y:r.minY));p.addLine(to:CGPoint(x:r.maxX-c,y:r.minY))
            p.addLine(to:CGPoint(x:r.maxX-c,y:r.minY+s));p.addLine(to:CGPoint(x:r.maxX-s,y:r.minY+s));p.addLine(to:CGPoint(x:r.maxX-s,y:r.minY+c))
            p.addLine(to:CGPoint(x:r.maxX,y:r.minY+c));p.addLine(to:CGPoint(x:r.maxX,y:r.maxY-c))
            p.addLine(to:CGPoint(x:r.maxX-s,y:r.maxY-c));p.addLine(to:CGPoint(x:r.maxX-s,y:r.maxY-s));p.addLine(to:CGPoint(x:r.maxX-c,y:r.maxY-s))
            p.addLine(to:CGPoint(x:r.maxX-c,y:r.maxY));p.addLine(to:CGPoint(x:r.minX+c,y:r.maxY))
            p.addLine(to:CGPoint(x:r.minX+c,y:r.maxY-s));p.addLine(to:CGPoint(x:r.minX+s,y:r.maxY-s));p.addLine(to:CGPoint(x:r.minX+s,y:r.maxY-c))
            p.addLine(to:CGPoint(x:r.minX,y:r.maxY-c));p.addLine(to:CGPoint(x:r.minX,y:r.minY+c))
            p.addLine(to:CGPoint(x:r.minX+s,y:r.minY+c));p.addLine(to:CGPoint(x:r.minX+s,y:r.minY+s));p.addLine(to:CGPoint(x:r.minX+c,y:r.minY+s));p.closeSubpath()
        }
    }
}
struct GamePanel<Content:View>:View {
    let title:String
    var symbol:String?=nil
    var compact=false
    var contentPadding:CGFloat?=nil
    var accessory:String?=nil
    var accessoryColor:Color?=nil
    @ViewBuilder var content:Content
    @Environment(\.colorScheme) private var scheme
    private var palette:GamePalette{GamePalette(dark:scheme == .dark)}
    var body:some View{
        VStack(alignment:.leading,spacing:0){
            HStack(spacing:3){
                HStack(spacing:5){
                    if let symbol{Image(systemName:symbol).accessibilityHidden(true)}
                    Text(title.uppercased()).tracking(0.8).lineLimit(1).layoutPriority(1)
                }.font(compact ? .system(size:10,weight:.medium):.caption.weight(.semibold))
                    .padding(.horizontal,compact ? 7:10).padding(.vertical,compact ? 3:5)
                    .background(LinearGradient(colors:[Color(hex:0x203746),palette.dialogue],startPoint:.top,endPoint:.bottom),in:UnevenRoundedRectangle(bottomLeadingRadius:8,bottomTrailingRadius:8))
                    .overlay{UnevenRoundedRectangle(bottomLeadingRadius:8,bottomTrailingRadius:8).stroke(.white.opacity(0.28),lineWidth:0.5)}
                    .foregroundStyle(palette.ivory).accessibilityAddTraits(.isHeader)
                Spacer(minLength:0)
                if let accessory{
                    HStack(spacing:3){if let accessoryColor{Circle().fill(accessoryColor).frame(width:4,height:4)};Text(accessory).lineLimit(1)}
                        .font(.system(size:compact ? 8:11)).foregroundStyle(accessoryColor ?? Color.white)
                        .padding(.horizontal,accessoryColor == nil ? 3:4).padding(.vertical,3)
                        .background{if accessoryColor != nil{UnevenRoundedRectangle(topLeadingRadius:6,bottomLeadingRadius:3).fill(palette.inset)}}
                }
            }.padding(.horizontal,3).padding(.top,2)
                .background(LinearGradient(stops:[.init(color:Color(hex:0x4A5158),location:0),.init(color:Color(hex:0x858783),location:0.47),.init(color:Color(hex:0x63686B),location:0.8),.init(color:Color(hex:0xA3A5A2),location:1)],startPoint:.topLeading,endPoint:.bottomTrailing))
            VStack(alignment:.leading,spacing:0){content}.padding(contentPadding ?? (compact ? 6:12)).frame(maxWidth:.infinity,alignment:.leading)
        }.background(LinearGradient(colors:[palette.panel,palette.inset],startPoint:.topLeading,endPoint:.bottomTrailing),in:RoundedRectangle(cornerRadius:8))
            .clipShape(RoundedRectangle(cornerRadius:8))
            .overlay{RoundedRectangle(cornerRadius:8).strokeBorder(palette.metal,lineWidth:2.5).allowsHitTesting(false)}
            .overlay{RoundedRectangle(cornerRadius:8).strokeBorder(.white.opacity(0.35),lineWidth:0.5).padding(0.5).allowsHitTesting(false)}
            .overlay{RoundedRectangle(cornerRadius:5.5).strokeBorder(Color.black.opacity(0.7),lineWidth:0.7).padding(3).allowsHitTesting(false)}
            .overlay{GameWindow(corner:3).stroke(palette.menuEdge.opacity(0.52),lineWidth:0.5).padding(4).allowsHitTesting(false)}
            .foregroundStyle(palette.text)
    }
}
struct GameMeter:View {
    let value:Double?
    var color:Color = .green
    let label:String
    let reading:String
    var height:CGFloat=5
    @Environment(\.colorScheme) private var scheme
    var body:some View {
        GeometryReader{g in
            ZStack(alignment:.leading){
                Rectangle().fill(Color.black.opacity(scheme == .dark ? 0.6:0.2))
                if let value{
                    Rectangle().fill(LinearGradient(stops:[.init(color:color.opacity(0.55),location:0),.init(color:color,location:0.35),.init(color:color,location:1)],startPoint:.top,endPoint:.bottom))
                        .frame(width:g.size.width*max(0,min(1,value)))
                }
            }
            .clipShape(GameWindow(corner:height >= 4 ? 1:0.5))
            .overlay{if height >= 4{GameWindow(corner:1).stroke(Color(hex:0xC5CEC2).opacity(0.6),lineWidth:0.5)}}
        }.frame(height:height).accessibilityElement(children:.ignore).accessibilityLabel(label).accessibilityValue(reading)
    }
}

private struct GameTileStyle:ViewModifier {
    @Environment(\.colorScheme) private var scheme
    func body(content:Content)->some View {
        let p=GamePalette(dark:scheme == .dark)
        content.background(LinearGradient(colors:[p.panel,p.inset],startPoint:.topLeading,endPoint:.bottomTrailing),in:GameWindow(corner:5))
            .overlay{GameWindow(corner:5).stroke(p.edge.opacity(0.7),lineWidth:1).allowsHitTesting(false)}
            .overlay{GameWindow(corner:3).stroke(p.menuEdge.opacity(0.25),lineWidth:0.5).padding(2).allowsHitTesting(false)}
    }
}
extension View {func gameTile()->some View{modifier(GameTileStyle())}}
