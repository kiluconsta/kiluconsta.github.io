// ═══════════════════════════════════════════════════════════════
// Coomer — media list (video)
//
// HOW TO EDIT (no build step needed — just edit, commit, done):
//   • Add a video:    "https://…",
//   • Trimmed clip:   { url: "https://…", start: 120, end: 155 },   (seconds)
//   • Section break:  null,          (label comes from DIV_LABELS, in order)
//   • Remove a video: delete its line.
//   Keep the trailing comma on every line. Order here = order on the page.
// ═══════════════════════════════════════════════════════════════
var DIV_LABELS = ["① Coomer Tings", "More Quick 🥜", "G0Q", "🍆✊🏾🥜🎥"];

var SOURCES = [
  null,
  "https://n4.coomer.st/data/b3/7f/b37f86e09928e199b9a69a2c14b1147cc419ed20bbf933e2f3a0c2a0908356c4.mp4?f=0gr6nxyj4pafa4776n97e_source.mp4",
  "https://n2.coomer.st/data/7a/4b/7a4be0acf265e42fde5a9be0ac2a942088836c95bf123c468d0272cf4b295c3d.mp4?f=0grior3h0x3o2av4m4s7a_source.mp4",
  null,
  null,
  null,
  "https://video.twimg.com/ext_tw_video/2123163119392350208/pr/pl/S77G7mdds0tELTib.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163124895236096/pr/pl/PbzEoEWfGNw3Jm17.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163134437314560/pr/pl/Z9w98eoixgkYfJl5.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163149188694016/pr/pl/NppVdEvBwXnZstQR.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163122831654913/pr/pl/RYWR9BootPcXsfJH.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163124589088768/pr/pl/F74sOIliGVJGMXJR.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163132168175616/pr/pl/0on3ykmAH39_i0de.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163151214559232/pr/pl/E4W19qeANA404-BD.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163115810365440/pr/pl/7D9F16EJDOzOZ3By.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163124970799105/pr/pl/NdaUPPX91gVi_HI_.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163132373741568/pr/pl/GE4iQbzxhu9dh_2L.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163162195251200/pr/pl/JwwZEmwQPVjYSDCU.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163105370763264/pr/pl/GD0hgwTY29safdhe.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163103466602496/pr/pl/8gGcTceESiAXmGlL.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163119958593536/pr/pl/q-2mDlY9qtM1-YhN.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163134391185408/pr/pl/M1gYThnJAMQ5Qv90.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163108738838528/pr/pl/jard2bdA6qsRnjre.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163111381217281/pr/pl/50CsgxEI5vz8YPm-.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163110160642048/pr/pl/QtFs6a4v6mOW2Qhv.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163128049397760/pr/pl/DaGjkWwoRyP_B4fx.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163111049809920/pr/pl/vja0-U3QbZRVDzts.m3u8?tag=12&variant_version=1",
  "https://video.twimg.com/ext_tw_video/2123163117366460416/pr/pl/7FBbC9QyRHShjui7.m3u8?tag=12&variant_version=1",
];
