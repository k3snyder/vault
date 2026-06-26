# Testing Reduced Motion Support

This guide explains how to test the reduced motion implementation for the Apple Principles Color Refinement specification.

## Quick Start

1. **Open the test file:**
   ```bash
   open src/tokens/reduced-motion-test.html
   ```
   Or open it directly in your browser.

2. **Enable Reduced Motion in Browser DevTools:**

   ### Chrome/Edge
   1. Open DevTools (F12 or Cmd+Option+I)
   2. Click the three dots (⋮) → More tools → Rendering
   3. Scroll to "Emulate CSS media feature prefers-reduced-motion"
   4. Select "reduce" from dropdown

   ### Safari
   1. Open Web Inspector (Cmd+Option+I)
   2. Go to Settings → Experimental Features
   3. Enable "prefers-reduced-motion: reduce"

   ### Firefox
   1. Open Developer Tools (F12)
   2. Type `about:config` in address bar
   3. Search for `ui.prefersReducedMotion`
   4. Set value to `1`

3. **Verify all tests pass:**
   - Test 1: All motion tokens show `0ms` ✅
   - Test 2-5: Manual verification of instant behavior ✅
   - Test 6: Easing curves still defined ✅

## What to Look For

### ✅ Passing Behavior

1. **Motion Token Values**
   - All 6 motion tokens display as `0ms`
   - Test 1 shows "PASS ✓" in green

2. **Theme Switching**
   - Click "Switch Theme" button
   - Theme changes **instantly** with no fade
   - Background, text, and border colors change immediately

3. **Modal Animation**
   - Click "Show Modal"
   - Modal appears **instantly** (no scale or fade animation)
   - Click "Close Modal"
   - Modal disappears **instantly**

4. **Hover States**
   - Hover over any button
   - Background and border colors change **instantly**
   - No visible transition or animation

5. **Functionality**
   - All buttons remain clickable
   - All interactions work correctly
   - No broken UI or stuck states

6. **Easing Curves**
   - All 5 easing curves still defined
   - Values show cubic-bezier functions
   - Test 6 shows "PASS ✓" in green

### ❌ Failing Behavior

If you see any of these, the implementation needs fixing:

1. **Motion tokens NOT 0ms** - Values like `100ms`, `150ms`, etc.
2. **Fade transitions** - Gradual color changes instead of instant
3. **Animated modal** - Scale or fade effects when opening/closing
4. **Smooth hover** - Color transitions instead of instant changes
5. **Broken functionality** - Buttons don't work, modal stuck, etc.
6. **Undefined easing** - Empty values or errors in console

## Testing Criteria Reference

From `apr-2.4` specification:

1. ✅ All motion tokens set to 0ms when prefers-reduced-motion: reduce
2. ✅ Theme switching is instant (no fade transitions)
3. ✅ Modal animations disabled (instant show/hide)
4. ✅ Hover state changes are instant
5. ✅ No broken interactions due to disabled animations
6. ✅ Application remains fully functional and usable
7. ✅ Easing curves defined but unused (0ms duration)

## Implementation Details

### CSS Media Query

**File:** `src/tokens/variables.css` (lines 680-692)

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    /* Disable all motion by setting durations to 0ms */
    --motion-instant: 0ms;
    --motion-micro: 0ms;
    --motion-small: 0ms;
    --motion-medium: 0ms;
    --motion-large: 0ms;
    --motion-xl: 0ms;

    /* Easing curves remain defined but have no effect with 0ms duration */
  }
}
```

### How It Works

1. **Browser Detection**: Browser detects system/user preference for reduced motion
2. **Media Query Activation**: `@media (prefers-reduced-motion: reduce)` triggers
3. **Token Override**: All `--motion-*` tokens set to `0ms`
4. **Instant Transitions**: All transitions using these tokens become instant
5. **Preserved Functionality**: All interactions still work, just without animation

### Why Easing Curves Remain Defined

Easing curves (e.g., `cubic-bezier(0.25, 0.1, 0.25, 1.0)`) are still defined because:
- They have no effect when duration is `0ms`
- Prevents undefined variable errors
- Allows smooth transition back when reduced motion is disabled
- Maintains backward compatibility

## Cross-Browser Testing

Test in all major browsers:

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome | ✅ Full | prefers-reduced-motion fully supported |
| Safari | ✅ Full | WebKit native support |
| Firefox | ✅ Full | Supported since Firefox 63 |
| Edge | ✅ Full | Chromium-based, full support |

## Platform Testing

### macOS
- System Preferences → Accessibility → Display → Reduce motion
- Test in both Safari (WebKit) and Chrome (Chromium)

### Windows
- Settings → Ease of Access → Display → Show animations in Windows
- Test in Edge (Chromium)

### Linux
- Desktop environment settings vary (GNOME, KDE, etc.)
- Test with GTK theme settings

## Accessibility Notes

### Who Benefits

1. **Vestibular Disorders**: Users with motion sensitivity
2. **Cognitive Disabilities**: Reduced cognitive load
3. **Photosensitive Users**: Fewer visual changes
4. **Battery Conservation**: Lower power consumption
5. **Performance**: Reduced GPU usage

### WCAG Compliance

- **Success Criterion 2.3.3**: Animation from Interactions (Level AAA)
- **Support Required**: Ability to disable motion triggered by interaction
- **Status**: ✅ Fully compliant

## Troubleshooting

### Test file doesn't load
```bash
# Check file exists
ls -l src/tokens/reduced-motion-test.html

# Check variables.css exists
ls -l src/tokens/variables.css
```

### Motion tokens show wrong values
1. Ensure reduced motion is enabled in DevTools
2. Refresh the page after enabling
3. Check browser console for CSS errors

### Modal still animates
1. Check if reduced motion media query is active:
   ```javascript
   window.matchMedia('(prefers-reduced-motion: reduce)').matches
   ```
2. Should return `true` when enabled

### All tests show "Manual verification required"
This is expected! Tests 2-5 require human observation because:
- Automated testing can't verify "instant" vs "fast"
- Visual perception is subjective
- Cross-browser behavior needs human verification

## Additional Resources

- **Test Results**: `.docs/specs/2025-12-13-apple-principles-color-refinement/test-results/apr-2.4-reduced-motion-results.md`
- **Spec**: `.docs/specs/2025-12-13-apple-principles-color-refinement/spec.md`
- **Implementation**: `src/tokens/variables.css` (lines 680-692)

---

**Last Updated:** 2025-12-13
**Maintainer:** Vault Development Team
**Status:** Production Ready ✅
