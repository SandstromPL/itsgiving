// The room's storage key, and the script that applies a saved room before first paint (layout.tsx), so a returning
// visitor never sees the default room flash. A plain module: the server layout and the picker both read it. A visitor
// who chose light under the old two-way switch keeps it; the old "dark" is today's default. The same script marks a
// homepage intro already seen in this tab (home/opening.tsx), so a reload doesn't flash the title card.

export const ROOM_KEY = "itsgiving:room";
const OLD_THEME_KEY = "itsgiving:theme";

export const THEME_SCRIPT = `try{var d=document.documentElement,r=localStorage.getItem("${ROOM_KEY}");if(!r&&localStorage.getItem("${OLD_THEME_KEY}")==="light")r="light";if(r==="tungsten"||r==="trix"||r==="light")d.dataset.room=r;d.dataset.theme=r==="light"?"light":"dark"}catch(e){}try{if(sessionStorage.getItem("itsgiving:intro")==="1")document.documentElement.dataset.intro="seen"}catch(e){}`;
