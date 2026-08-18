/** The base game, written once.
 *
 *  `rulesCatalog` covers the four house rules a host can switch on. This covers
 *  everything that is always true, so the rules slide and the in-game help can be
 *  built from shared prose rather than from strings scattered across screens.
 *
 *  Same shape as `RuleInfo` minus `default`: nothing here is optional.
 */
export interface BasicInfo {
  id: 'match' | 'actions' | 'wilds' | 'draw' | 'lastCard' | 'opening';
  title: { ru: string; en: string };
  tagline: { ru: string; en: string }; // one line, for the slide
  details: { ru: string; en: string }; // the full text, for help
}

export const BASICS_CATALOG: readonly BasicInfo[] = [
  {
    id: 'match',
    title: { ru: 'Как ходить', en: 'Making a move' },
    tagline: {
      ru: 'Кладись по цвету, по числу или по значку.',
      en: 'Match the colour, the number, or the symbol.',
    },
    details: {
      ru: 'Своя карта ложится на верхнюю, если совпадает хотя бы в одном: цвет, число '
        + 'или значок действия. Красная 7 ложится на любую красную и на любую семёрку. '
        + 'Дикие карты подходят всегда.',
      en: 'Your card goes on top if it matches in at least one way: colour, number, or '
        + 'action symbol. A red 7 covers any red card and any seven. Wilds always fit.',
    },
  },
  {
    id: 'actions',
    title: { ru: 'Карты действия', en: 'Action cards' },
    tagline: {
      ru: 'Пропуск, разворот и +2 — по одной на каждый цвет.',
      en: 'Skip, Reverse and Draw 2 — one of each in every colour.',
    },
    details: {
      ru: 'Пропуск лишает следующего игрока хода. Разворот меняет направление игры, '
        + 'а вдвоём работает как пропуск — ход возвращается тебе. +2 заставляет '
        + 'следующего взять две карты и пропустить ход.',
      en: 'Skip takes the next player’s turn away. Reverse flips the direction of play — '
        + 'and with two players it acts as a Skip, handing the turn straight back to you. '
        + 'Draw 2 makes the next player take two cards and lose their turn.',
    },
  },
  {
    id: 'wilds',
    title: { ru: 'Дикие карты', en: 'Wilds' },
    tagline: {
      ru: 'Ложатся всегда, и ты называешь цвет.',
      en: 'Always playable, and you call the colour.',
    },
    details: {
      ru: 'Дикую карту можно положить в любой момент своего хода; сыграв её, ты '
        + 'называешь цвет, которым игра продолжится. Дикая +4 вдобавок заставляет '
        + 'следующего взять четыре карты и пропустить ход. Оспорить её нельзя.',
      en: 'A wild can go down at any point on your turn, and playing it lets you name the '
        + 'colour play continues in. A Wild Draw 4 also makes the next player take four '
        + 'cards and lose their turn. There is no challenge.',
    },
  },
  {
    id: 'draw',
    title: { ru: 'Когда нечем ходить', en: 'When nothing fits' },
    tagline: {
      ru: 'Возьми карту — сыграй её или передай ход.',
      en: 'Take a card — play it, or pass the turn.',
    },
    details: {
      ru: 'Если подходящей карты нет, возьми одну из колоды. Подошла — можешь сыграть '
        + 'её сразу же; не подошла или не хочешь — ход переходит дальше. Когда колода '
        + 'кончается, сброс без верхней карты перемешивается заново.',
      en: 'With nothing playable, take one card from the pile. If it fits you may play it '
        + 'right away; if it does not, or you would rather keep it, the turn passes. When '
        + 'the pile runs out, the discard minus its top card is shuffled back.',
    },
  },
  {
    id: 'lastCard',
    title: { ru: 'Последняя карта', en: 'The last card' },
    tagline: {
      ru: 'Назовись, пока осталась одна — иначе поймают на две.',
      en: 'Call it on your last card, or get caught for two.',
    },
    details: {
      ru: 'Сыграв предпоследнюю карту, нажми «последняя карта» — до или сразу после хода. '
        + 'Пока следующий игрок не сходил, любой за столом может тебя поймать, и тогда ты '
        + 'берёшь две карты. Успел назваться — ловить нечего.',
      en: 'Playing your second-to-last card opens a window: press “last card”, either just '
        + 'before or right after the play. Until the next player acts, anyone at the table '
        + 'may catch you, and a catch costs you two cards. Call in time and there is '
        + 'nothing to catch.',
    },
  },
  {
    id: 'opening',
    title: { ru: 'Начало раунда', en: 'How a round opens' },
    tagline: {
      ru: 'Раунд всегда открывает числовая карта.',
      en: 'A round always opens on a number card.',
    },
    details: {
      ru: 'Раздача — отдельный шаг перед раундом: колода тасуется, каждому по семь карт, '
        + 'а затем карты переворачиваются, пока не выпадет числовая. Всё остальное уходит '
        + 'под низ колоды и остаётся в игре. Так никого не штрафуют и не пропускают до '
        + 'первого хода. В официальных правилах UNO это не так — там стартовая карта '
        + 'действия срабатывает на первом игроке.',
      en: 'Dealing is its own step before the round: the deck is shuffled, everyone gets '
        + 'seven, and then cards are turned over until a number appears. Anything else goes '
        + 'to the bottom of the pile and stays in play. Nobody is penalised or skipped '
        + 'before they have played a card. Official UNO differs here — there a flipped '
        + 'action card takes effect on the starting player.',
    },
  },
];
