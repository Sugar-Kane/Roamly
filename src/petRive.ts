// Rive asset manifest for the companion stage.
//
// Each entry upgrades one species from the emoji glyph to a real Rive
// state-machine animation (skeletal idle/walk/sleep). Species without an
// entry — or whose file fails to load — keep the emoji rendering, so the
// stage always works and Rive pets light up per-species as .riv files land
// in public/rive/.
//
// Sourcing: author in the Rive editor (rive.app) or remix a Community-
// licensed file from the Rive marketplace, export as .riv, drop it in
// public/rive/<species>.riv, and register it here. The state machine should
// expose boolean inputs for walking and sleeping; name them below. Inputs
// that a file doesn't have are simply skipped.

import type { PetSpecies } from "./petCatalog";

export type RivePetDef = {
  src: string; // servable path, e.g. "/rive/dog.riv"
  stateMachine: string; // state machine name inside the artboard
  inputs: { walk?: string; sleep?: string }; // boolean input names
};

// Vetted marketplace candidates (all CC BY — credit the author when enabling;
// verified 2026-07-14, clean single-character artboards, public CDN hosted):
//  * dog — "Interactive Dog Mascot" by PraneethKawyaThathsara (~874 KB)
//    https://rive.app/marketplace/27226-51415-interactive-dog-mascot-for-mobile-apps-rive-state-machine/
//    file: https://public.rive.app/community/runtime-files/27226-51415-interactive-dog-mascot-for-mobile-apps-rive-state-machine.riv
//    stateMachine: "State Machine 1"
//  * rabbit — "Interactive Bunny Character" by raivu (~258 KB)
//    https://rive.app/marketplace/24876-46460-interactive-bunny-character/
//    file: https://public.rive.app/community/runtime-files/24876-46460-interactive-bunny-character.riv
//    stateMachine: "State Machine 1"
//  * bird — "Idle bird" by kiranironhide.ironhide (~116 KB)
//    https://rive.app/marketplace/5762-11268-idle-bird/
//    file: https://public.rive.app/community/runtime-files/5762-11268-idle-bird.riv
//    stateMachine: "State Machine 1"
// To enable one: download the file into public/rive/<species>.riv, add the
// entry below, and check its boolean input names in the Rive editor (entries
// with no matching inputs still play their default state-machine loop).
export const RIVE_PETS: Partial<Record<PetSpecies, RivePetDef>> = {
  // dog: { src: "/rive/dog.riv", stateMachine: "State Machine 1", inputs: {} },
};

export const hasRivePets = (): boolean => Object.keys(RIVE_PETS).length > 0;
