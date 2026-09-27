import Foundation

public enum DictationPermission: Sendable { case notDetermined, authorized, denied, restricted }

/// What the Speech framework offers for the current language.
public enum DictationRecognizer: Sendable {
    /// No recognizer for the language.
    case unsupportedLocale
    /// Recognition would need Apple's servers; the Suite never sends audio off the device.
    case serverOnly
    /// On-device recognition exists but is unavailable right now.
    case unavailable
    case onDevice
}

/// Whether the mic button may record. Permissions are requested only on the
/// first use, and only when on-device recognition can serve the request.
public enum DictationReadiness: Equatable, Sendable {
    case ready
    case needsPermission
    case blocked(String)

    public static let noMicrophone = "No microphone is available. Connect one, or type your request."
    public static let nothingHeard = "I didn’t catch that. Try again, or type your request."

    public static func evaluate(usageDescriptions: Bool, speech: DictationPermission, microphone: DictationPermission,
                                recognizer: DictationRecognizer, language: String) -> DictationReadiness {
        // Without the usage descriptions the system would terminate the app on the permission request.
        guard usageDescriptions else { return .blocked("Voice requests need the packaged Pokémon Suite app. Type your request instead.") }
        switch recognizer {
        case .unsupportedLocale: return .blocked("Speech recognition isn’t available for \(language). Type your request instead.")
        case .serverOnly: return .blocked("On-device speech recognition isn’t available for \(language) here, and Pokémon Suite never sends your voice to a server. Type your request instead.")
        case .unavailable, .onDevice: break
        }
        switch speech {
        case .denied: return .blocked("Speech recognition is turned off for Pokémon Suite. Allow it in Privacy & Security settings, or type your request.")
        case .restricted: return .blocked("Speech recognition is restricted on this device. Type your request instead.")
        default: break
        }
        switch microphone {
        case .denied: return .blocked("Microphone access is turned off for Pokémon Suite. Allow it in Privacy & Security settings, or type your request.")
        case .restricted: return .blocked("The microphone is restricted on this device. Type your request instead.")
        default: break
        }
        if speech == .notDetermined || microphone == .notDetermined { return .needsPermission }
        if recognizer == .unavailable { return .blocked("Speech recognition is unavailable right now. Try again in a moment, or type your request.") }
        return .ready
    }
}
