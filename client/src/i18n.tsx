// Lightweight ru/en UI dictionaries — no library, per the beta core spec.
// Rule prose lives in shared/src/rulesCatalog.ts; THIS file owns every other
// user-facing string. Server rejections arrive as snake_case codes → terr().
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'ru' | 'en';
const STORE_KEY = 'ochre:locale';

const DICT = {
  en: {
    'app.notFoundTitle': 'Table not found',
    'app.notFoundBody': 'The link may have expired — tables close after a while.',
    'app.backToStart': 'Back to start',
    'landing.note': 'No account. No install. Two to four seats.',
    'landing.h1a': 'A private table', 'landing.h1b': 'in ten seconds',
    'landing.sub': 'Match the colour, keep up with the table, and don’t forget to shout. Make a room, send the link, deal.',
    'landing.create': 'Create a room', 'landing.haveInvite': 'I have an invite',
    'landing.joinTitle': 'Join a table',
    'landing.joinSub': 'Type the five-character code your host sent you.',
    'landing.tokenLabel': 'Room code', 'landing.tokenHint': 'Ask your host — five characters, e.g. K7M3X',
    'landing.find': 'Find the table',
    'landing.eyebrow': 'A quick-draw card game',
    'landing.joinCta': 'Join with a code',
    'landing.hostDecides': 'The host decides',
    'landing.allRules': 'All four rules ↓',
    'how.title': 'How it works',
    'how.s1t': 'Create a room',
    'how.s1b': 'One tap. You get a five-character code and a link, and you are the host.',
    'how.s2t': 'Send the link',
    'how.s2b': 'Anyone who opens it lands at the table. Add a PIN if the room should stay yours.',
    'how.s3t': 'Deal',
    'how.s3b': 'Seven cards each, two to four seats. The game starts when you say so.',
    'house.title': 'House rules',
    'house.sub': 'Four switches, set by whoever makes the room. Everyone sees them before the first card.',
    'house.on': 'on', 'house.off': 'off',
    'see.title': 'See it',
    'see.cap1': 'A plain turn: four hands, one card chosen, the pot passed on.',
    'see.cap2': 'A wild goes down and the called colour floods the table.',
    'see.cap3': 'The call, the catch window, the last card, the counter-two.',
    'play.title': 'How the game plays',
    'play.sub': 'Ten seconds of reading and you can sit down at any table.',
    'play.ourRule': 'Our rule', 'play.caught': 'CAUGHT',
    'close.title': 'Make the room. Send the link.',
    'close.sub': 'It takes longer to explain than to do.',
    'bar.join': 'Join', 'bar.roomCode': 'Room code', 'bar.cancel': 'Cancel',
    'create.title': 'House rules', 'create.hostTag': 'You’re the host',
    'create.sub': 'Agree these before the first deal. They lock once the game starts.',
    'create.pinLabel': 'Room PIN (optional)', 'create.pinHint': '4 digits — players are asked for it at the door',
    'create.createBtn': 'Create the room',
    'create.linkLabel': 'Invite link', 'create.copy': 'Copy', 'create.copied': 'Copied',
    'create.token': 'Code {code}', 'create.open': 'Open the room',
    'join.title': 'Join the table', 'join.sub': 'Table {code} — pick a name and take a seat.',
    'join.nameLabel': 'Your name at the table', 'join.sit': 'Take a seat',
    'join.pinTitle': 'This table has a PIN', 'join.pinLabel': '4-digit PIN', 'join.pinGo': 'Enter',
    'lobby.tableOf': '{name}’s table', 'lobby.copy': 'Copy invite', 'lobby.copied': 'Copied',
    'lobby.seatOpen': 'Seat open', 'lobby.waiting': 'waiting', 'lobby.away': 'away',
    'lobby.host': 'Host', 'lobby.ready': 'Ready', 'lobby.you': '(you)',
    'lobby.seated': '{n} of 4 seated', 'lobby.canStart': ' · you can start any time',
    'lobby.deal': 'Deal the first hand', 'lobby.waitHost': 'Waiting for the host to deal…',
    'lobby.pinChip': 'PIN {pin}', 'lobby.pinSet': 'Set a PIN', 'lobby.pinRemove': 'Remove PIN',
    'rules.classic': 'Classic rules',
    // Sub-project E: the pre-round slide and the in-game help share this vocabulary,
    // because they are the same panel of rules seen at two different moments.
    'rules.slideTitle': 'Before we deal',
    'rules.slideSub': 'Ten seconds now so nobody argues on card three.',
    'rules.basics': 'How it plays',
    'rules.atThisTable': 'At this table',
    'rules.classicLine': 'Classic rules — your host switched nothing on.',
    'rules.gotIt': 'Got it, deal',
    'rules.helpOpen': 'Rules',
    'rules.close': 'Close',
    'table.yourTurn': 'YOUR TURN', 'table.playing': 'PLAYING',
    'table.uno': 'UNO!', 'table.catch': 'Catch!',
    'table.endTurn': 'End turn', 'table.discardN': 'Discard {n}', 'table.clear': 'Clear',
    'table.leave': 'Leave', 'table.tableOf': '{name}’s table · Round {n}',
    'table.draw': 'Draw · {n}', 'table.drawMatch': 'Draw to match · {n}', 'table.takeN': 'Take +{n}',
    'table.cards.one': '{n} card', 'table.cards.other': '{n} cards',
    'table.thinking': 'Thinking…', 'table.away': 'Away',
    'table.pend': '+{n} on you — stack a {card} or draw',
    'table.chooseColour': 'Choose a colour',
    'table.flipWild': 'The flip was wild — choose a colour',
    'table.forcedWild': 'Force play — your wild goes down',
    'table.called': '{color} called',
    'st.answer': 'Answer the +{n} or take it',
    'st.drawn': 'Play the drawn card or end your turn',
    'st.throwing': 'Throwing {n} together',
    'st.turn': 'Your turn · {n} playable',
    'st.waiting': 'Waiting for {name}…',
    't.you': 'You', 't.youLower': 'you',
    't.reversed': 'Direction reversed',
    't.youSitOut': 'You sit out', 't.sitsOut': '{name} sits out',
    't.pot': '+{n} → {name}', 't.stacked': ' (stacked)',
    't.draws': '{name} draws {n}',
    't.called': '{name} called UNO!',
    't.caught': '{name} got caught missing UNO — +2',
    'over.youTake': 'You take it', 'over.takes': '{name} takes it',
    'over.round': 'Round {n}', 'over.youEmptied': 'you emptied your hand first',
    'over.finishWith': 'you finish with {n}',
    'over.out': 'out', 'over.left': '{n} left',
    'over.wins.one': '{n} win', 'over.wins.other': '{n} wins',
    'over.again': 'Play again', 'over.leave': 'Leave',
    'pause.waiting': 'Waiting for {name}…',
    'pause.body': 'Their seat is held — the game resumes the moment they reopen the link.',
    'pause.continue': 'Continue without them',
    'color.red': 'Red', 'color.yellow': 'Yellow', 'color.green': 'Green', 'color.blue': 'Blue',
    'err.round_over': 'The round is over', 'err.bad_seat': 'Bad seat',
    'err.no_color_pending': 'No colour choice pending', 'err.play_drawn_or_pass': 'Play the drawn card or end your turn',
    'err.card_not_in_hand': 'That card is not in your hand', 'err.answer_pot': 'Answer the penalty or take it',
    'err.card_no_match': 'That card does not match', 'err.wild_needs_color': 'Pick a colour for the wild',
    'err.not_your_turn': 'Not your turn', 'err.choose_color_first': 'Choose a colour first',
    'err.nothing_to_pass': 'Nothing to pass', 'err.force_play': 'Force play — the drawn card goes down',
    'err.cannot_call_now': 'You can’t call now', 'err.nothing_to_catch': 'Nothing to catch',
    'err.cannot_catch_self': 'You can’t catch yourself',
    'err.table_not_found': 'Table not found', 'err.game_started': 'The game already started',
    'err.table_full': 'The table is full', 'err.seat_not_found': 'Seat not found',
    'err.host_only_rules': 'Only the host changes this', 'err.rules_locked': 'Locked once the game starts',
    'err.host_only_deal': 'Only the host can deal', 'err.already_dealt': 'Already dealt',
    'err.need_two_players': 'You need at least two players', 'err.no_round': 'No round in progress',
    'err.round_running': 'The round is still running', 'err.not_enough_players': 'Not enough players',
    'err.no_such_seat': 'No such seat', 'err.player_connected': 'That player is connected',
    'err.grace_running': 'Give them a moment — the grace period is running',
    'err.pin_required': 'This table asks for a PIN', 'err.wrong_pin': 'Wrong PIN — try again',
    'err.bad_pin': 'A PIN is exactly 4 digits', 'err.bad_stack': 'Those cards can’t go down together',
    'err.rate_limited': 'Too many attempts — wait a minute',
  },
  ru: {
    'app.notFoundTitle': 'Стол не найден',
    'app.notFoundBody': 'Похоже, ссылка устарела: столы через какое-то время закрываются сами.',
    'app.backToStart': 'На главную',
    'landing.note': 'Без регистрации. Без установки. От двух до четырёх мест.',
    'landing.h1a': 'Свой стол', 'landing.h1b': 'за десять секунд',
    'landing.sub': 'Клади по цвету, держи темп и не забудь объявить последнюю. Создай комнату, отправь ссылку, раздавай.',
    'landing.create': 'Создать комнату', 'landing.haveInvite': 'У меня есть код',
    'landing.joinTitle': 'Вход по коду',
    'landing.joinSub': 'Введи пять символов, которые прислал хост.',
    'landing.tokenLabel': 'Код комнаты', 'landing.tokenHint': 'Пять символов от хоста — например, K7M3X',
    'landing.find': 'Найти стол',
    'landing.eyebrow': 'Карточная игра на скорость',
    'landing.joinCta': 'Войти по коду',
    'landing.hostDecides': 'Решает хост',
    'landing.allRules': 'Все четыре правила ↓',
    'how.title': 'Как это работает',
    'how.s1t': 'Создай комнату',
    'how.s1b': 'Одно нажатие — и у тебя код из пяти символов, ссылка и права хоста.',
    'how.s2t': 'Отправь ссылку',
    'how.s2b': 'Кто откроет её, тот за столом. Нужен свой круг — поставь PIN.',
    'how.s3t': 'Раздавай',
    'how.s3b': 'По семь карт на каждого, от двух до четырёх мест. Игра начнётся, когда скажешь.',
    'house.title': 'Правила стола',
    'house.sub': 'Четыре переключателя. Их ставит тот, кто создал комнату, и все видят их до первой карты.',
    'house.on': 'вкл', 'house.off': 'выкл',
    'see.title': 'Посмотри',
    'see.cap1': 'Обычный ход: четыре руки, одна карта — и очередь пошла дальше.',
    'see.cap2': 'Дикая ложится, и названный цвет заливает стол.',
    'see.cap3': 'Объявление, окно для перехвата, последняя карта — и +2 тому, кто смолчал.',
    'play.title': 'Как играть',
    'play.sub': 'Десять секунд чтения — и можно садиться за любой стол.',
    'play.ourRule': 'Наше правило', 'play.caught': 'ПОЙМАЛИ',
    'close.title': 'Создай стол. Отправь ссылку.',
    'close.sub': 'Объяснять дольше, чем сделать.',
    'bar.join': 'Войти', 'bar.roomCode': 'Код комнаты', 'bar.cancel': 'Отмена',
    'create.title': 'Правила стола', 'create.hostTag': 'Ты — хост',
    'create.sub': 'Договоритесь до первой раздачи — со стартом игры они фиксируются.',
    'create.pinLabel': 'PIN комнаты (необязательно)', 'create.pinHint': '4 цифры — их спросят на входе',
    'create.createBtn': 'Создать комнату',
    'create.linkLabel': 'Ссылка-приглашение', 'create.copy': 'Копировать', 'create.copied': 'Скопировано',
    'create.token': 'Код {code}', 'create.open': 'Войти в комнату',
    'join.title': 'За стол', 'join.sub': 'Стол {code} — представься и садись.',
    'join.nameLabel': 'Твоё имя за столом', 'join.sit': 'Сесть за стол',
    'join.pinTitle': 'Этот стол под PIN-кодом', 'join.pinLabel': 'PIN из 4 цифр', 'join.pinGo': 'Войти',
    'lobby.tableOf': 'Стол {name}', 'lobby.copy': 'Скопировать приглашение', 'lobby.copied': 'Скопировано',
    'lobby.seatOpen': 'Место свободно', 'lobby.waiting': 'ждём', 'lobby.away': 'не в сети',
    'lobby.host': 'Хост', 'lobby.ready': 'На месте', 'lobby.you': '(ты)',
    'lobby.seated': '{n} из 4 за столом', 'lobby.canStart': ' · можно начинать',
    'lobby.deal': 'Раздать первую руку', 'lobby.waitHost': 'Ждём, пока хост раздаст…',
    'lobby.pinChip': 'PIN {pin}', 'lobby.pinSet': 'Поставить PIN', 'lobby.pinRemove': 'Убрать PIN',
    'rules.classic': 'Классика',
    'rules.slideTitle': 'Перед раздачей',
    'rules.slideSub': 'Десять секунд сейчас — чтобы не спорить на третьей карте.',
    'rules.basics': 'Как играют',
    'rules.atThisTable': 'За этим столом',
    'rules.classicLine': 'Классика — хост не включил ни одного домашнего правила.',
    'rules.gotIt': 'Понятно, раздавай',
    'rules.helpOpen': 'Правила',
    'rules.close': 'Закрыть',
    'table.yourTurn': 'ТВОЙ ХОД', 'table.playing': 'ИГРАЕТ',
    'table.uno': 'UNO!', 'table.catch': 'Поймать!',
    'table.endTurn': 'Завершить ход', 'table.discardN': 'Сбросить {n}', 'table.clear': 'Отменить',
    'table.leave': 'Выйти', 'table.tableOf': 'Стол {name} · Раунд {n}',
    'table.draw': 'Взять · {n}', 'table.drawMatch': 'Тянуть до подходящей · {n}', 'table.takeN': 'Взять +{n}',
    'table.cards.one': '{n} карта', 'table.cards.few': '{n} карты',
    'table.cards.many': '{n} карт', 'table.cards.other': '{n} карт',
    'table.thinking': 'Думает…', 'table.away': 'Не в сети',
    'table.pend': '+{n} на тебе — переведи {card} или бери',
    'table.chooseColour': 'Выбери цвет',
    'table.flipWild': 'Открылась дикая — выбери цвет',
    'table.forcedWild': 'Обязательный ход — дикая ложится сразу',
    'table.called': 'Выбран {color}',
    'st.answer': 'Ответь на +{n} или бери',
    'st.drawn': 'Сыграй вытянутую или заверши ход',
    'st.throwing': 'Сбросишь {n} разом',
    'st.turn': 'Твой ход · подходит: {n}',
    'st.waiting': 'Ждём {name}…',
    't.you': 'Ты', 't.youLower': 'тебя',
    't.reversed': 'Направление сменилось',
    't.youSitOut': 'Ты пропускаешь ход', 't.sitsOut': '{name} пропускает ход',
    't.pot': '+{n} → {name}', 't.stacked': ' (перевод)',
    't.draws': '{name} берёт {n}',
    't.called': '{name} объявляет UNO!',
    't.caught': 'Поймали {name} без UNO — +2',
    'over.youTake': 'Ты забираешь раунд', 'over.takes': '{name} забирает раунд',
    'over.round': 'Раунд {n}', 'over.youEmptied': 'твоя рука опустела первой',
    'over.finishWith': 'в руке ещё {n}',
    'over.out': 'без карт', 'over.left': 'осталось {n}',
    'over.wins.one': '{n} победа', 'over.wins.few': '{n} победы',
    'over.wins.many': '{n} побед', 'over.wins.other': '{n} побед',
    'over.again': 'Ещё раз', 'over.leave': 'Выйти',
    'pause.waiting': 'Ждём {name}…',
    'pause.body': 'Место сохранено — игра продолжится, как только ссылку откроют снова.',
    'pause.continue': 'Продолжить без ожидания',
    'color.red': 'Красный', 'color.yellow': 'Жёлтый', 'color.green': 'Зелёный', 'color.blue': 'Синий',
    'err.round_over': 'Раунд окончен', 'err.bad_seat': 'Нет такого места',
    'err.no_color_pending': 'Цвет сейчас не выбирают', 'err.play_drawn_or_pass': 'Сыграй вытянутую карту или заверши ход',
    'err.card_not_in_hand': 'Этой карты нет в руке', 'err.answer_pot': 'Ответь на штраф или возьми его',
    'err.card_no_match': 'Карта не подходит', 'err.wild_needs_color': 'Выбери цвет для дикой',
    'err.not_your_turn': 'Не твой ход', 'err.choose_color_first': 'Сначала выбери цвет',
    'err.nothing_to_pass': 'Сначала возьми карту', 'err.force_play': 'Обязательный ход — вытянутая карта ложится',
    'err.cannot_call_now': 'Объявлять пока рано', 'err.nothing_to_catch': 'Ловить нечего',
    'err.cannot_catch_self': 'Себя не поймаешь',
    'err.table_not_found': 'Стол не найден', 'err.game_started': 'Игра уже началась',
    'err.table_full': 'Стол заполнен', 'err.seat_not_found': 'Место не найдено',
    'err.host_only_rules': 'Это меняет только хост', 'err.rules_locked': 'После старта правила не меняются',
    'err.host_only_deal': 'Раздаёт только хост', 'err.already_dealt': 'Уже раздали',
    'err.need_two_players': 'Нужно хотя бы два игрока', 'err.no_round': 'Раунд не идёт',
    'err.round_running': 'Раунд ещё идёт', 'err.not_enough_players': 'Игроков не хватает',
    'err.no_such_seat': 'Нет такого места', 'err.player_connected': 'Игрок на связи',
    'err.grace_running': 'Подожди — у игрока ещё есть время вернуться',
    'err.pin_required': 'Стол просит PIN', 'err.wrong_pin': 'Неверный PIN — попробуй ещё',
    'err.bad_pin': 'PIN — это ровно 4 цифры', 'err.bad_stack': 'Эти карты нельзя сбросить вместе',
    'err.rate_limited': 'Слишком много попыток — подожди минуту',
  },
} as const;

export type MsgKey = keyof (typeof DICT)['en'];

/** Labels stored as `<base>.<plural form>` instead of as one string, read through
 *  `tn`. English wants two forms here and Russian four, so the dictionaries carry
 *  what each language needs and the call site only supplies the number. */
export type PluralKey = 'table.cards' | 'over.wins';
const PLURALS: Record<Locale, Intl.PluralRules> = {
  ru: new Intl.PluralRules('ru'),
  en: new Intl.PluralRules('en'),
};

export const detectLocale = (): Locale => {
  const stored = localStorage.getItem(STORE_KEY);
  if (stored === 'ru' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
};

const Ctx = createContext<{ locale: Locale; setLocale: (l: Locale) => void } | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const value = useMemo(() => ({
    locale,
    setLocale: (l: Locale) => { localStorage.setItem(STORE_KEY, l); setLocaleState(l); },
  }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useT outside LocaleProvider');
  const fill = (s: string, vars?: Record<string, string | number>): string => {
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
  const t = (key: MsgKey, vars?: Record<string, string | number>): string =>
    fill(DICT[ctx.locale][key] ?? DICT.en[key] ?? key, vars);
  /** A label that changes shape with its number: «1 карта», «2 карты», «5 карт».
   *  Which form a count takes is the locale's business, not the call site's, so
   *  Intl picks the suffix and the dictionary supplies the wording. A language
   *  that does not need a form simply omits it and falls back to `other`. */
  const tn = (key: PluralKey, n: number): string => {
    const d = DICT[ctx.locale] as Record<string, string>;
    return fill(d[`${key}.${PLURALS[ctx.locale].select(n)}`] ?? d[`${key}.other`] ?? key, { n });
  };
  /** Localize a server rejection code; unknown codes fall back to the raw code. */
  const terr = (code: string): string =>
    (DICT[ctx.locale] as Record<string, string>)[`err.${code}`] ?? code;
  return { t, tn, terr, locale: ctx.locale, setLocale: ctx.setLocale };
}

export function LangSwitcher() {
  const { locale, setLocale } = useT();
  return (
    <button type="button" className="btn btn-ghost lang-switch"
      onClick={() => setLocale(locale === 'ru' ? 'en' : 'ru')}>
      {locale === 'ru' ? 'EN' : 'RU'}
    </button>
  );
}
