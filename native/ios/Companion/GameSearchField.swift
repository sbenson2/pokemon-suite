import SwiftUI

/// An always-visible native search field inside the framed page, independent
/// of the navigation bar used by modal detail screens.
struct GameSearchField: UIViewRepresentable {
    let prompt: String
    @Binding var text: String
    @Environment(\.colorScheme) private var scheme

    init(_ prompt: String, text: Binding<String>) {
        self.prompt = prompt
        _text = text
    }
    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }
    func makeUIView(context: Context) -> UISearchBar {
        let bar = UISearchBar()
        bar.delegate = context.coordinator
        bar.searchBarStyle = .minimal
        bar.autocapitalizationType = .none
        bar.autocorrectionType = .no
        bar.searchTextField.adjustsFontForContentSizeCategory = true
        bar.setContentHuggingPriority(.required, for: .vertical)
        bar.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return bar
    }
    func updateUIView(_ bar: UISearchBar, context: Context) {
        let palette = GamePalette(dark: scheme == .dark)
        context.coordinator.text = $text
        if bar.text != text { bar.text = text }
        bar.placeholder = prompt
        bar.searchTextField.accessibilityLabel = prompt
        bar.searchTextField.font = .preferredFont(forTextStyle: .body)
        bar.searchTextField.textColor = UIColor(palette.text)
        bar.searchTextField.backgroundColor = UIColor(palette.inset)
        bar.tintColor = UIColor(palette.focus)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UISearchBar, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 280, height: max(52, UIFont.preferredFont(forTextStyle: .body).lineHeight + 24))
    }
    final class Coordinator: NSObject, UISearchBarDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }
        func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) { text.wrappedValue = searchText }
        func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { searchBar.resignFirstResponder() }
    }
}

struct GameFormRowBackground: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { GamePalette(dark: scheme == .dark).panel }
}
