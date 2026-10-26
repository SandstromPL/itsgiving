// The theme choice's storage key, and the script that applies a saved choice before first paint (layout.tsx), so a
// returning visitor never sees the wrong room flash. A plain module: the server layout and the switch both read it.

export const THEME_KEY = "itsgiving:theme";

export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
