import AppKit

enum SuiteKeyboard {
    static let characters: [CGKeyCode: UniChar] = [
        0:97, 1:115, 6:122, 7:120, 17:116, 3:102, 5:103, 4:104,
        12:113, 13:119, 18:49, 19:50, 46:109, 45:110,
        34:105, 40:107, 38:106, 37:108,
    ]

    static func resolve(_ logical: CGKeyCode, layout: [CGKeyCode: UniChar]) -> CGKeyCode {
        guard let character=characters[logical] else { return logical }
        return layout.keys.sorted().first { layout[$0]==character } ?? logical
    }

    static func currentLayout() -> [CGKeyCode: UniChar] {
        var layout=[CGKeyCode:UniChar]()
        for code in CGKeyCode(0)..<128 {
            guard let event=CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:true) else { continue }
            event.flags=[]
            var count=0;var characters=[UniChar](repeating:0,count:8)
            event.keyboardGetUnicodeString(maxStringLength:8,actualStringLength:&count,unicodeString:&characters)
            if count==1 { let c=characters[0];layout[code]=(65...90).contains(c) ? c+32 : c }
        }
        return layout
    }
}
