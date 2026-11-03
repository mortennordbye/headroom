import Foundation
import CoreGraphics
// Prints epoch ms once a window owned by "Headroom" is on screen, then exits.
while true {
  let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
  let hit = list.contains { w in
    guard (w[kCGWindowOwnerName as String] as? String) == "Headroom" else { return false }
    let b = w[kCGWindowBounds as String] as? [String: Any]
    return ((b?["Width"] as? Double) ?? 0) > 500
  }
  if hit { print(Int(Date().timeIntervalSince1970 * 1000)); exit(0) }
  usleep(10000)
}
