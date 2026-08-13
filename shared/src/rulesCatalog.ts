import type { Rules } from './types.js';

export interface RuleInfo {
  id: keyof Rules;
  title: { ru: string; en: string };
  tagline: { ru: string; en: string };
  details: { ru: string; en: string };
  default: boolean;
}

export const RULES_CATALOG: readonly RuleInfo[] = [
  {
    id: 'stacking',
    title: { ru: 'Перевод штрафа', en: 'Pass the penalty' },
    tagline: {
      ru: '+2 отбивается только +2, +4 — только +4; штраф едет дальше.',
      en: '+2 answers +2, +4 answers +4 — the pot rides on.',
    },
    details: {
      ru: 'Получив +2, можно не брать карты, а ответить своей +2 — тогда следующий '
        + 'игрок должен уже +4. Пот от +4 отбивается только другой +4. Цвет карты-ответа '
        + 'не важен. Кто не может или не хочет ответить — берёт весь накопленный штраф '
        + 'и пропускает ход.',
      en: 'When a +2 lands on you, you may answer with your own +2 instead of drawing — '
        + 'the next player then owes +4. A +4 pot can only be answered with another +4. '
        + 'The answer card’s color does not matter. Whoever cannot (or will not) answer '
        + 'draws the whole pot and misses their turn.',
    },
    default: false,
  },
  {
    id: 'forcePlay',
    title: { ru: 'Форс-плей', en: 'Force play' },
    tagline: {
      ru: 'Вытянутая играбельная карта сразу ложится.',
      en: 'A drawn playable card goes straight down.',
    },
    details: {
      ru: 'Если карта, которую ты вытянул, подходит — она сразу идёт в сброс, придержать '
        + 'её нельзя. Дикие карты ждут, пока ты выберешь цвет.',
      en: 'If the card you draw can be played, it is played immediately — no keeping it '
        + 'for later. Wilds still wait for you to pick a color.',
    },
    default: false,
  },
  {
    id: 'drawToMatch',
    title: { ru: 'Тяни до совпадения', en: 'Draw to match' },
    tagline: {
      ru: 'Нечем ходить — тяни, пока не придёт подходящая.',
      en: 'No play? Draw until something plays.',
    },
    details: {
      ru: 'Когда нечем ходить, ты тянешь не одну карту, а до первой играбельной. '
        + 'Штрафы +2/+4 не меняются — там берётся ровно столько, сколько написано. '
        + 'Если колода кончилась, ход переходит дальше.',
      en: 'When you cannot (or will not) play, you do not draw just one card — you keep '
        + 'drawing until you hit a playable one. Penalties (+2/+4) are unaffected: those '
        + 'are exact counts. If the deck runs dry, your turn passes.',
    },
    default: false,
  },
  {
    id: 'multiDiscard',
    title: { ru: 'Сброс стопкой', en: 'Stack discard' },
    tagline: {
      ru: 'Один номинал, любые цвета — сбрось разом.',
      en: 'Same number, any colors — throw them together.',
    },
    details: {
      ru: 'За один ход можно сбросить несколько числовых карт одного номинала — '
        + 'например, синюю 5, красную 5 и зелёную 5. Первая должна подходить по обычным '
        + 'правилам; последняя сброшенная задаёт цвет. Карты действий стопкой не сбрасываются.',
      en: 'You may discard several number cards of the same value in one turn — say, a '
        + 'blue 5 with a red 5 and a green 5. The first must be playable as usual; the '
        + 'last one thrown sets the color. Action cards cannot be stacked.',
    },
    default: false,
  },
];
