import AppKit

@main struct KeyboardTests {
    static func main() {
        let dvorak: [CGKeyCode: UniChar] = [5:105,32:103,17:121,40:116]
        precondition(SuiteKeyboard.resolve(5,layout:dvorak)==32,"Down must send G on Dvorak, not the physical US G position which produces I")
        precondition(SuiteKeyboard.resolve(17,layout:dvorak)==40,"Up must send T on Dvorak")
        precondition(SuiteKeyboard.resolve(5,layout:[5:103])==5,"US keyboard bindings stay the same")
        precondition(SuiteKeyboard.resolve(125,layout:dvorak)==125,"Arrow keys remain independent of letter layout")
        print("PASS: 3DS controls resolve the active keyboard layout")
    }
}
