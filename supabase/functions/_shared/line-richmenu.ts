/**
 * Rich menu definition for the LINE OA. The 2500x1686 image is split into a
 * 3x2 grid (6 regions). Upload with scripts/setup-line-richmenu.ts.
 *
 * Layout (each cell ~833x843):
 *   ┌──────────────┬──────────────┬──────────────┐
 *   │ 📷 ถ่ายใบเสร็จ │ 💬 บันทึกด่วน  │ 📊 สรุปภาษี    │
 *   ├──────────────┼──────────────┼──────────────┤
 *   │ 📁 รายงาน     │ ⏰ แจ้งเตือน   │ ❓ วิธีใช้      │
 *   └──────────────┴──────────────┴──────────────┘
 */
export const RICH_MENU = (liffId: string) => ({
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'AppFinance main',
  chatBarText: 'เมนู',
  areas: [
    // Row 1
    {
      bounds: { x: 0, y: 0, width: 833, height: 843 },
      action: { type: 'uri', label: 'ถ่ายใบเสร็จ', uri: `https://liff.line.me/${liffId}/capture` },
    },
    {
      bounds: { x: 833, y: 0, width: 834, height: 843 },
      // Prompts the user to just type — opens the keyboard with a hint
      action: { type: 'message', label: 'บันทึกด่วน', text: 'บันทึกรายการ: ' },
    },
    {
      bounds: { x: 1667, y: 0, width: 833, height: 843 },
      action: { type: 'postback', label: 'สรุปภาษี', data: 'action=summary' },
    },
    // Row 2
    {
      bounds: { x: 0, y: 843, width: 833, height: 843 },
      action: { type: 'postback', label: 'รายงาน', data: 'action=reports' },
    },
    {
      bounds: { x: 833, y: 843, width: 834, height: 843 },
      action: { type: 'postback', label: 'แจ้งเตือน', data: 'action=reminders' },
    },
    {
      bounds: { x: 1667, y: 843, width: 833, height: 843 },
      action: { type: 'postback', label: 'วิธีใช้', data: 'action=help' },
    },
  ],
});
