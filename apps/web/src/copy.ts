// Copy, on the client.
//
// There is no second catalogue and no second lookup: @lian/i18n is a pure
// module, so the asset pipeline serves it to the browser and the client
// imports the SAME t() the server calls. A translation layer here would be a
// second place copy could drift, which is the failure LESSONS §7 describes in
// the theme layer.
export { t, moodPhrase, CATALOG, type CopyKey } from '@lian/i18n';
export type AssistantGender = 'female' | 'male';
