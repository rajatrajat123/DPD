/**
 * Calculates dynamic keyboard avoidance padding across Android device architectures:
 *
 * Case 1: Standard Android with native adjustResize (Phone 1)
 *   The OS window shrinks natively by ~kbHeight (nativeShrinkage >= kbHeight - 25).
 *   Compensation needed: 0. Avoids duplicate shrinkage, blank gap, or displacement.
 *
 * Case 2: Edge-to-edge / curved-screen Android (Phone 2)
 *   The Activity window does NOT shrink (nativeShrinkage = 0).
 *   The container's bottom edge is already bounded above the navigation bar.
 *   The keyboard intrudes into the container by exactly kbHeight.
 *   Compensation needed: kbHeight (without double-counting bottomInset).
 *   Lifts the message composer directly above the IME keyboard boundary.
 *
 * Case 3: Partial native resize
 *   If the window shrinks partially, applies the exact remaining uncompensated difference:
 *   Math.max(0, kbHeight - nativeShrinkage).
 */
export function computeAndroidKeyboardCompensation(params: {
  kbHeight: number;
  idleHeight: number;
  currentHeight: number;
  bottomInset?: number;
  keyboardScreenY?: number;
}): number {
  const { kbHeight, idleHeight, currentHeight, bottomInset = 0, keyboardScreenY } = params;
  if (kbHeight <= 0) return 0;

  const nativeShrinkage = Math.max(0, idleHeight - currentHeight);
  // Full native resize threshold (allow 25dp tolerance for system bar differences)
  if (nativeShrinkage >= kbHeight - 25) {
    return 0; // Case 1: Phone A (OS already resized Activity window)
  }

  // If accurate keyboardScreenY is provided and within valid screen bounds:
  if (keyboardScreenY && keyboardScreenY > 0 && keyboardScreenY < idleHeight) {
    const screenSpaceIntrusion = idleHeight - keyboardScreenY;
    return Math.max(0, screenSpaceIntrusion - nativeShrinkage);
  }

  // Geometric edge-to-edge calculation:
  // Keyboard intrudes from the bottom of the unresized container by kbHeight + bottomInset
  return Math.max(0, kbHeight + bottomInset - nativeShrinkage);
}
