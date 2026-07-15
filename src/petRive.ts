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

export const RIVE_PETS: Partial<Record<PetSpecies, RivePetDef>> = {
  // dog: { src: "/rive/dog.riv", stateMachine: "Pet", inputs: { walk: "walk", sleep: "sleep" } },
};

export const hasRivePets = (): boolean => Object.keys(RIVE_PETS).length > 0;
