import Foundation
import CryptoKit
import Security

public struct SuitePairing: Codable, Equatable, Sendable {
    public let version: Int
    public let name: String
    public let url: URL
    public let token: String
    public let certificateSHA256: String
    public init(code: String) throws {
        let text=code.trimmingCharacters(in:.whitespacesAndNewlines)
        guard text.utf8.count <= 4096 else { throw SuiteError("This connection code is too long.") }
        let data: Data?
        if text.hasPrefix("pokesuite:") {
            var value=String(text.dropFirst(10)).replacingOccurrences(of:"-",with:"+").replacingOccurrences(of:"_",with:"/")
            value += String(repeating:"=",count:(4-value.count%4)%4)
            data=Data(base64Encoded:value)
        } else { data=text.data(using:.utf8) }
        guard let data, let parsed=try? JSONDecoder().decode(Self.self,from:data), parsed.version==1,
              parsed.url.scheme=="https", parsed.url.host?.isEmpty==false, parsed.url.user==nil, parsed.url.password==nil,
              parsed.url.query==nil, parsed.url.fragment==nil, ["", "/"].contains(parsed.url.path),
              parsed.token.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,
              parsed.certificateSHA256.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else {
            throw SuiteError("Paste the full connection code from Pokémon Suite on your Mac.")
        }
        self=parsed
    }
    public var code: String { "pokesuite:" + ((try? JSONEncoder().encode(self)) ?? Data()).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_") }
}

public final class SuiteTrust: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let fingerprint: String?
    public init(fingerprint: String?) { self.fingerprint=fingerprint }
    public func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        Self.handle(challenge,fingerprint:fingerprint,completion:completionHandler)
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    public static func handle(_ challenge: URLAuthenticationChallenge, fingerprint: String?, completion: @escaping (URLSession.AuthChallengeDisposition,URLCredential?)->Void) {
        guard let fingerprint else { completion(.performDefaultHandling,nil);return }
        guard challenge.protectionSpace.authenticationMethod==NSURLAuthenticationMethodServerTrust,
              let trust=challenge.protectionSpace.serverTrust,
              let certificate=(SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first,
              SHA256.hash(data:SecCertificateCopyData(certificate) as Data).map({String(format:"%02x",$0)}).joined()==fingerprint else {
            completion(.cancelAuthenticationChallenge,nil);return
        }
        completion(.useCredential,URLCredential(trust:trust))
    }
}
