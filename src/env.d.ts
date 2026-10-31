// The build-time variable Vite reads from the environment (docs/design/lab_ui.md section 20): VITE_LAB_LOCAL=1 makes a local build, which offers the Break-out screen even while the figures it
// shows rest on sources below main-reread. Any other value, or none, is the public build.
interface ImportMetaEnv {
  readonly VITE_LAB_LOCAL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
