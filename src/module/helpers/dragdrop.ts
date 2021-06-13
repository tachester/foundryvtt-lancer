import { EntryType, LiveEntryTypes, OpCtx, RegEntry, RegRef } from "machine-mind";
import { AnyLancerActor, is_actor_type, LancerActor, LancerActorType } from "../actor/lancer-actor";
import { PACK_SCOPE } from "../compBuilder";
import { AnyLancerItem, is_item_type, LancerItem, LancerItemType } from "../item/lancer-item";
import { FoundryReg, FoundryRegName } from "../mm-util/foundry-reg";
import { get_pack_id, mm_wrap_actor, mm_wrap_item } from "../mm-util/helpers";
import { gentle_merge, is_ref, safe_json_parse } from "./commons";
import { recreate_ref_from_element } from "./refs";

////////////// DRAGON DROPS ////////////
// Very useful:
// https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Drag_operations#drop
// more raw api data:
// https://developer.mozilla.org/en-US/docs/Web/API/Document/drag_event

/**
 * Enables dropability on the specified jquery items/query.
 * The first argument is either an existing jquery object, or a string with which to $() make it
 *
 * The second argument is a callback provided with the data for the drag, the dest of the drag, as well as the dragover event.
 * It is called once, on a successful drop
 * Not all of these arguments are usually necessary: remember you can just _ away unused vars
 *
 * The third argument is an optional callback provided with the dest of the drag, as well as the dragover event.
 * It determines if the dest is a valid drop target
 *
 * The fourth and final argument is an optional callback provided with all info as the drop handler, but also is informed if the mouse is entering or exiting
 * This can be used for fancier on-hover enter/exit visual behavior. It is only called if dropping is permitted on that item
 */
type DropHandlerFunc = (data: string, drag_dest: JQuery, drop_event: JQuery.DropEvent) => void;
type AllowDropPredicateFunc = (
  data: string,
  drag_dest: JQuery,
  dragover_event: JQuery.DragOverEvent | JQuery.DragEnterEvent | JQuery.DragLeaveEvent
) => boolean;
type HoverHandlerFunc = (
  mode: "enter" | "leave",
  data: string,
  drag_dest: JQuery,
  drag_event: JQuery.DragEnterEvent | JQuery.DragLeaveEvent
) => void;

export function enable_dropping(
  items: string | JQuery,
  drop_handler: DropHandlerFunc,
  allow_drop?: AllowDropPredicateFunc,
  hover_handler?: HoverHandlerFunc
) {
  // Force to jq
  if (typeof items == "string") {
    items = $(items);
  }

  // Bind these individually, so we don't have to rely so much on the drop target being preserved
  items.each((_, _item) => {
    let item = $(_item);

    // To permit dropping, we must override the base dragover behavior.
    item.on("dragover", event => {
      // Get/check data
      let data = event.originalEvent?.dataTransfer?.getData("text/plain");
      if (!data) return;

      // Check if we can drop
      let drop_permitted = !allow_drop || allow_drop(data, item, event);

      // If permitted, override behavior to allow drops
      if (drop_permitted) {
        event.preventDefault();
        return false;
      }
    });

    // We also must signal this via the dragenter event
    item.on("dragenter", event => {
      // Get/check data. Don't want to fire on elements we cant even drop in
      let data = event.originalEvent?.dataTransfer?.getData("text/plain");
      if (!data) return;

      // Check if we can drop
      let drop_permitted = !allow_drop || allow_drop(data, item, event);

      if (drop_permitted) {
        // Override behavior to allow dropping here
        event.preventDefault();

        // While we're here, fire hover handler if drop is allowed
        if (hover_handler) {
          hover_handler("enter", data, item, event);
        }
        return false;
      }

      return true; // I guess?
    });

    // Bind a leave if we are doing hover stuff
    if (hover_handler) {
      item.on("dragleave", event => {
        // Get/check data
        let data = event.originalEvent?.dataTransfer?.getData("text/plain");
        if (!data) return;

        // Unfortunately, the docs read as though we still need to check if a drag was permitted on the item we are leaving. Browser doesn't seem to remember!
        let drop_permitted = !allow_drop || allow_drop(data, item, event);

        if (drop_permitted) {
          hover_handler("leave", data, item, event);
        }
      });
    }

    // Finally and most importantly, dropping
    item.on("drop", event => {
      // Get/check data
      let data = event.originalEvent?.dataTransfer?.getData("text/plain");
      if (!data) return;

      drop_handler(data, item, event);

      event.preventDefault();
    });
  });
}

/**
 * Enables draggability on the specified jquery items/query.
 * The first argument is either an existing jquery object, or a string with which to $() make it
 * The second argument is a callback that deduces the drag payload from the drag element. Also provides event, if that is eaasier
 * The third argument is an optional callback that facillitates toggling styling changes on the drag source
 */
type DragDeriveDataFunc = (drag_source: JQuery, event: JQuery.DragStartEvent) => string;
type DragStartEndFunc = (
  mode: "start" | "stop",
  drag_source: JQuery,
  event: JQuery.DragStartEvent | JQuery.DragEndEvent
) => void;
// type AllowDragFunc = (drag_source: JQuery, event: JQuery.DragStartEvent | JQuery.DragEndEvent) => void;
export function enable_dragging(
  items: string | JQuery,
  data_transfer_func: DragDeriveDataFunc,
  start_stop_func?: DragStartEndFunc
  // allow_drag_func?: AllowDragFunc
) {
  // Force to jq
  if (typeof items == "string") {
    items = $(items);
  }

  // Make draggable
  items.prop("draggable", true);

  // Bind these individually, so we don't have to rely so much on the drop target being preserved
  items.each((_, _item) => {
    let item = $(_item);
    item.on("dragstart", event => {
      // Set data using callback
      event.originalEvent!.dataTransfer!.setData("text/plain", data_transfer_func(item, event));

      // We don't want weird double trouble on drags
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Trigger start if necessary
      if (start_stop_func) {
        start_stop_func("start", item, event);
      }
    });

    // Handle drag ends
    item.on("dragend", event => {
      // Call stop func if we have one
      if (start_stop_func) {
        start_stop_func("stop", item, event);
      }
    });
  });
}

export type NewNativeDrop = ({
      type: "Item";
    }
  | {
      type: "ActiveEffect";
  }) & {
    test: string;
  };


// "Everything" that foundry will natively drop. Scene dropping,  are not yet implemented
type _DropContextInfo = {
  pack?: string; // Compendium pack we are dragging from
  actorId?: string; // If provided, this is the actor that the dragged item is embedded in
  tokenId?: string; // If provided, the document is embedded in a token synthetic actor associated with this token
  sceneId?: string; // If provided, the document is embedded in a token in this scene
  // Note: It is not necessarily safe to assume that tokenId implies sceneId, since floating combat tokens exist, maybe? Its iffy. Tread cautiously
};
type _PhysicalDrop =  
    (
      { type: "Item"; }
      | 
      { type: "ActiveEffect"; }
      | 
      { type: "Actor"; }
    ) 
    & 
    _DropContextInfo
    &
    { id: string; };

// Meta here handles weirder stuff like journals, scenes, sounds, macros, etc 
type _MetaDrop = {
  type: "JournalEntry";
  id: string;
  pack?: string;
}

export type NativeDrop = _PhysicalDrop | _MetaDrop;

// Result of resolving a native drop to its corresponding entity
export type ResolvedNativeDrop =
  | {
      type: "Item";
      entity: AnyLancerItem;
    }
  | {
      type: "Actor";
      entity: AnyLancerActor;
    }
  | {
      type: "JournalEntry";
      entity: JournalEntry;
    }
  | null;

// Resolves a native foundry actor/item drop event datatransfer to the actual contained item
export async function resolve_native_drop(event_data: string): Promise<ResolvedNativeDrop> {
  // Get dropped data
  let drop = safe_json_parse(event_data) as NativeDrop;
  if (!drop) return null;

  if (drop.type == "Item") {
    let item: LancerItem<LancerItemType> | null = null;
    if (drop.pack && drop.actorId) {
      // Case 1 - Item is from a Compendium actor item
      // @ts-ignore 0.8
      let actor = (await game.packs.get(drop.pack)?.getDocument(drop.actorId)) as AnyLancerActor | undefined;
      item = (actor?.items.get(drop.id) ?? null) as AnyLancerItem | null;
    } else if(drop.sceneId && drop.tokenId) {
      // Case 2 - Item is a token actor item
      // @ts-ignore 0.8
      let actor = game.scenes.get(drop.sceneId)?.tokens.get(drop.tokenId)?.actor as AnyLancerActor | undefined;
      item = (actor?.items.get(drop.id) ?? null) as AnyLancerItem | null;
    } else if(drop.actorId) {
      // Case 3 - Item is a game actor item
      let actor = game.actors.get(drop.actorId);
      item = (actor?.items.get(drop.id) ?? null) as AnyLancerItem | null;
    } else if (drop.pack) {
      // Case 4 - Item is from a Compendium 
      // @ts-ignore 0.8
      item = ((await game.packs.get(drop.pack)!.getDocument(drop.id)) ?? null) as AnyLancerItem | null;
    } else {
      // Case 5 - item is a game item
      item = (game.items.get(drop.id) ?? null) as LancerItem<any> | null;
    }

    // Return if it exists
    if (item) {
      return {
        type: "Item",
        entity: item,
      };
    }
  } else if (drop.type == "Actor") {
    // Same deal
    let actor: LancerActor<LancerActorType> | null = null;

    if (drop.pack) {
      // Case 1 - Actor is from a Compendium pack
      // @ts-ignore 0.8
      actor = ((await game.packs.get(drop.pack)!.getDocument(drop.id)) ?? null) as AnyLancerActor | null
    } else if(drop.sceneId && drop.actorId) {
      // Case 2 - Actor is a scene token
      // @ts-ignore 0.8
      actor = (game.scenes.get(drop.sceneId)?.tokens.get(drop.tokenId)?.actor ?? null) as AnyLancerActor | null;
    } else {
      // Case 3 - Actor is a game actor
      actor = (game.actors.get(drop.id) ?? null) as AnyLancerActor | null;
    }

    if (actor) {
      return {
        type: "Actor",
        entity: actor,
      };
    }
  } else if (drop.type == "JournalEntry") {
    // Same deal
    let journal: JournalEntry | null = null;

    // Case 1 - JournalEntry is from a Compendium pack
    if (drop.pack) {
      // @ts-ignore 0.8
      journal = ((await game.packs.get(drop.pack)!.getDocument(drop.id)) ?? null) as JournalEntry | null;
    }

    // Case 2 - JournalEntry is a World entity
    else {
      journal = (game.journals.get(drop.id) ?? null) as JournalEntry | null;
    }

    if (journal) {
      return {
        type: "JournalEntry",
        entity: journal,
      };
    }
  }

  // All else fails
  console.log(`Couldn't resolve native drop:`, drop);
  return null;
}

// Turns a regref into a native drop, if possible
export function convert_ref_to_native_drop<T extends EntryType>(ref: RegRef<T>): NativeDrop | null {
  // Can't handle null typed refs
  if (!ref.type) {
    console.error("Attempted to turn a null-typed ref into a native drop. This is, generally, impossible");
    return null;  
  } 

  // Build out our scaffold
  let evt: Partial<_PhysicalDrop> = {};

  // Parse the reg name
  let rn = FoundryReg.parse_reg_args(ref.reg_name as FoundryRegName);

  // Decide type
  if(is_item_type(ref.type)) {
    evt.type = "Item";
  } else if (is_actor_type(ref.type)) {
    evt.type = "Actor";
  } else {
    console.error("Couldn't convert the following ref into a native foundry drop event:", ref);
    return null;
  }

  // Decide pack
  if(rn.src == "comp_core") {
    evt.pack = get_pack_id(ref.type)
  } else if(rn.src == "comp") {
    evt.pack = rn.comp_id;
  } 

  // Decide scene
  if(rn.src == "scene") {
    evt.sceneId = rn.scene_id;
    evt.tokenId = ref.id;
  } else if(rn.src == "scene_token") {
    evt.sceneId = rn.scene_id;
    evt.tokenId = rn.token_id;
  }

  // Decide actor id
  if(rn.src == "comp_actor") {
    evt.actorId = rn.actor_id;
  } else if(rn.src == "game_actor") {
    evt.actorId = rn.actor_id;
  } else if(rn.src == "scene_token") {
    // @ts-ignore
    evt.actorId = game.scenes.get(evt.sceneId)?.tokens.get(evt.tokenId)?.actor.id;
  }
  
  // Decide ID, which is slightly weird for scene token actors
  if(rn.src == "scene") {
    // @ts-ignore
    evt.id = game.scenes.get(evt.sceneId)?.tokens.get(evt.tokenId)?.actor.id;
  } else {
    evt.id = ref.id;
  }

  // Done
  return evt as NativeDrop;
}

// Wraps a call to enable_dropping to specifically handle RegRef drops.
// Convenient for if you really only care about the final resolved RegEntry result
// Allows use of hover_handler for styling
export function enable_simple_ref_dropping(
  items: string | JQuery,
  on_drop: (entry: RegEntry<any>, dest: JQuery, evt: JQuery.DropEvent) => void,
  hover_handler?: HoverHandlerFunc
) {
  enable_dropping(
    items,
    async (ref_json, dest, evt) => {
      let recon_ref: any = safe_json_parse(ref_json);
      let dest_type = dest[0].dataset.type;

      // If it isn't a ref, we don't handle
      if (!is_ref(recon_ref)) {
        return;
      }

      // If it doesn't match type, we also don't handle
      if (dest_type && !dest_type.includes(recon_ref.type)) {
        return;
      }

      // It is a ref, so we stop anyone else from handling the drop
      // (immediate props are fine)
      evt.stopPropagation();

      // Resolve the data. Just use a new ctx. Maybe should accept as arg, but lets not overcomplicate
      let resolved = await new FoundryReg().resolve(new OpCtx(), recon_ref);
      if (resolved) {
        on_drop(resolved, dest, evt);
      } else {
        console.error("Failed to resolve ref", recon_ref);
      }
    },

    // Allow drop simply checks if it is a ref and that the type matches the type on the elt
    (data, dest) => {
      // Parse our drag data as a ref
      let recon_ref = safe_json_parse(data);
      if (is_ref(recon_ref)) {
        let dest_type = dest[0].dataset.type;
        return (dest_type || "").includes(recon_ref.type); // Simply confirm same type. Using includes allows for multiple types
      }
      return false;
    },
    hover_handler
  );
}

// Wraps a call to enable_dragging that attempts to derive a RegRef JSON from the dragged element
export function enable_simple_ref_dragging(items: string | JQuery, start_stop?: DragStartEndFunc) {
  enable_dragging(
    items,
    drag_src => {
      // Drag a JSON ref
      let ref = recreate_ref_from_element(drag_src[0]);
      if (ref) {
        return JSON.stringify(ref);
      } else {
        return "";
      }
    },
    start_stop
  );
}

// Adds a drop handler for native drops, e.x. drag item from the sidebar to a sheet
export function enable_native_dropping(
  items: string | JQuery,
  on_drop: (
    entity: LancerActor<LancerActorType> | LancerItem<LancerItemType> | JournalEntry,
    dest: JQuery,
    evt: JQuery.DropEvent
  ) => void,
  allowed_types?: (EntryType | "journal")[] | null, // null implies wildcard. `data-type` always takes precedence
  hover_handler?: HoverHandlerFunc
) {
  enable_dropping(
    items,
    async (drop_json, dest, evt) => {
      // We resolve it as a real item
      let resolved = await resolve_native_drop(drop_json);

      // If it doesn't exist, well, darn
      if (!resolved) {
        return;
      }
      evt.stopPropagation();

      // Figure out its type
      let type: EntryType | "journal";
      if (resolved.type == "JournalEntry") {
        type = "journal";
      } else {
        type = resolved.entity.data.type;
      }

      // Get our actual allowed types, as it can be overriden by data-type
      let dest_type = dest[0].dataset.type ?? (allowed_types ?? []).join(" ");

      // Now, as far as whether it should really have any effect, that depends on the type
      if (!dest_type || dest_type.includes(type)) {
        // We're golden. Call the callback
        on_drop(resolved.entity, dest, evt);
      }
    },
    (data, dest) => {
      // We have no idea if we should truly be able to drop here since we don't know what we're dropping
      // As such, we simply determine that it is in fact a native drag
      // Having a simple cache resolving the item is possible, but expensive / could potentially bloat really hard
      // An LRU cache would work? Long term goal, if performance ever becomes a big deal
      let pdata = safe_json_parse(data) as NativeDrop;

      if (pdata?.id !== undefined && pdata?.type !== undefined) {
        return true;
      }
      return false;
    },
    hover_handler
  );
}

// Same as above, but wraps in a MM context
export function enable_native_dropping_mm_wrap<T extends EntryType>(
  items: string | JQuery,
  on_drop: (ent: LiveEntryTypes<T>, dest: JQuery, evt: JQuery.DropEvent) => void,
  allowed_types?: T[] | null, // null implies wildcard. `data-type` always takes precedence
  hover_handler?: HoverHandlerFunc
) {
  enable_native_dropping(
    items,
    async (entity, dest, evt) => {
      // From here, depends slightly on tye
      let item: LiveEntryTypes<T>;
      let ent_type = (entity as any).entity;
      console.error("You meant to investigate this");
      if (ent_type == "Actor") {
        item = await mm_wrap_actor(entity as LancerActor<T & LancerActorType>, new OpCtx());
      } else if (ent_type == "Item") {
        item = await mm_wrap_item(entity as LancerItem<T & LancerItemType>, new OpCtx());
      } else {
        return;
      }

      // Make callback
      on_drop(item, dest, evt);
    },
    allowed_types,
    hover_handler
  );
}
/*
 */
