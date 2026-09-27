import Foundation

/// Guards a recent stream capture; this is not a reconstructed or live map.
public struct FieldPreviewGate {
    private var previousKey:String?
    private var previousFrame:Int?
    public init(){}
    public static func identity(_ s:JSONValue)->String? {
        let game=s["game"].string,session=s["sessionId"].string
        let map=s["observation"]["map"]["id"].string.nonempty ?? s["map"].string
        guard !game.isEmpty,!session.isEmpty,!map.isEmpty else{return nil}
        return [game,session,map].joined(separator:"|")
    }
    public mutating func observe(_ s:JSONValue,now:Date,connected:Bool)->Bool {
        let date=ISO8601DateFormatter()
        date.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let updated=date.date(from:s["updatedAt"].string) ?? ISO8601DateFormatter().date(from:s["updatedAt"].string)
        guard connected,let key=Self.identity(s),s["mode"].string=="overworld",s["observation"]["phase"].string=="stable",
              let updated,(-1...5).contains(now.timeIntervalSince(updated)),case .number(let frame)=s["frame"],frame >= 0,frame<Double(Int.max) else {
            previousKey=nil;previousFrame=nil;return false
        }
        let capture=previousKey==key && previousFrame.map{Int(frame)>$0}==true
        previousKey=key;previousFrame=Int(frame)
        return capture
    }
}
