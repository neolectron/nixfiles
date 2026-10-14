# Stream Deck editor

Operate mode. A familiar device preview with an adjacent property inspector,
with left presses operating the deck and explicit editing controls. The hardware
strip retains its existing visual authority; this document applies to the editor.

Graphite surfaces suit the physical deck on Manuel's desktop. A warm pale accent
marks selection and the primary save action; green communicates connected state.
Use Liberation Sans throughout, tabular numbers for controls and code type only
for command arguments/output. Keep the deck visually dominant, inspect selected
keys without modal interruption, and make saved/unsaved/error states explicit.
Visible copy uses labels, values and operational status; omit routine explanatory
paragraphs. Parameter guidance and plugin descriptions remain in tooltips, with
ARIA descriptions on fields. Connection setup retains its required identifiers,
redirect URI and portal link instead of a prose walkthrough.

Desktop: device preview at left, tabbed configuration at right, without a global
navbar. The detected model name and connection indicator lead the preview; the
status dot sits before the name, with the connection label below the name on all
screen sizes. Before USB detection the title stays generic.
Édition keeps the selected key/dial inspector. Plugins groups activation switches
and per-plugin collapsible configuration; switches remain reachable when collapsed.
Each plugin groups its exported tiles and settings into separate tabs. The palette
uses the deck's key renderer at a smaller scale, with a separate six-dot grip.
Clicking prepares a draft on the selected key; dragging prepares it on the target
key. Both return to Édition; saving is explicit and neither executes the action.
Disabled plugins keep their tiles available.
Layout and tile edits share one browser-local draft, with Enregistrer and Annuler
above the device. Switching keys keeps every form, including incomplete fields.
Dragging, pinning, creating folders/zones/pages and editing tile parameters only
change the preview. Save submits the whole configuration once. Unsaved key actions
are inactive; folder/back/page faces navigate the draft locally. Audio controls
remain operational. Conflict/error states preserve the draft for correction or
explicit discard; the connection indicator continues to reflect the real device.
Tab changes preserve unsaved drafts. Narrow screens: configuration below the preview;
the grid follows the device's columns. No decorative
motion, metrics, marketing content or unfinished navigation. Physical knob
selection explains the current mixer assignment. Key faces invoke their configured simple/double/long gestures. The corner pencil
(on hover or keyboard focus) and right click open editing without invoking an
action. The numbered corner is a separate pointer drag handle; Alt + arrows also
rearrange. USB disconnection changes the status beside the device name and leaves web actions live.
