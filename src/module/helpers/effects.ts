import type { HelperOptions } from "handlebars";
import { LancerActiveEffect } from "../effects/lancer-active-effect";

/**
 * Handlebars helper for a single effect
 */
export function effect_view(effect: LancerActiveEffect, helper: HelperOptions): string {
  // @ts-expect-error
  let label = effect.label;
  return `<div class="flexrow active-effect" data-uuid="${effect.uuid}">
                <div>
                    Label: ${label}
                </div>
                <a class="lancer-context-menu" data-context-menu="active-effect">
                    <i class="fas fa-ellipsis-v"></i>
                </a>
            </div>`;
}

/**
 * Handlebars helper for an entire smattering of effects
 */
export function effect_categories_view(
  effects: ReturnType<typeof LancerActiveEffect["prepareActiveEffectCategories"]>,
  helper: HelperOptions
) {
  let categories = [] as string[];
  for (let cat of effects) {
    // if(!cat.effects.length) continue;
    categories.push(`
        <div class="card clipped">
            <span class="lancer-header submajor">${cat.label}</span>
            <div class="flexcol">
                ${cat.effects.map(e => effect_view(e, helper)).join("")}
            </div>
        </div>
        `);
  }
  return `<div class="flexcol">${categories.join("")} </div>`;
}