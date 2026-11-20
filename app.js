// Если код сломается, покажет окошко с ошибкой
window.onerror = (msg) => alert('Ошибка: ' + msg);

// ===== 1. Подключение к Supabase =====
const SUPABASE_URL = 'https://ucaxncwqldckeccxikkx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hwZmQpjmivFPj1k1a576Iw_9bHL25uQ';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let me = null;          // мой профиль после входа
let isRegister = false; // false = вход, true = регистрация
const $ = id => document.getElementById(id);

// ===== 2. Переключение экранов =====
function showScreen(name) {
  ['auth', 'main', 'chat'].forEach(n =>
    $('screen-' + n).classList.toggle('hidden', n !== name));
}

// ===== 3. Вход и регистрация =====
$('auth-switch').onclick = () => {
  isRegister = !isRegister;
  document.querySelector('.reg-only').classList.toggle('hidden', !isRegister);
  $('auth-btn').textContent = isRegister ? 'Создать аккаунт' : 'Войти';
  $('auth-switch').textContent = isRegister
    ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация';
  $('auth-error').textContent = '';
};

$('auth-btn').onclick = async () => {
  const username = $('auth-username').value.trim().toLowerCase().replace('@', '');
  const password = $('auth-password').value;
  const name = $('auth-name').value.trim();
  const err = $('auth-error');
  err.textContent = '';

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    err.textContent = 'Ник: 3–20 символов, латиница, цифры или _'; return;
  }
  if (password.length < 6) {
    err.textContent = 'Пароль должен быть от 6 символов'; return;
  }

  // Supabase требует почту, поэтому делаем её из ника (человек её не видит)
  const email = username + '@messenger.app';

  try {
    if (isRegister) {
      if (!name) { err.textContent = 'Введи имя'; return; }

      const { data, error } = await db.auth.signUp({ email, password });
      if (error) {
        err.textContent = error.message.includes('already')
          ? 'Такой ник уже занят' : error.message;
        return;
      }
      if (!data.session) {
        err.textContent = 'В Supabase выключи Confirm email'; return;
      }

      const { error: e2 } = await db.from('profiles')
        .insert({ id: data.user.id, username, name });
      if (e2) {
        await db.auth.signOut();
        err.textContent = 'Не удалось создать профиль: ' + e2.message;
        return;
      }
    } else {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) {
        err.textContent = error.message.includes('Invalid login')
          ? 'Неверный ник или пароль' : error.message;
        return;
      }
    }
    start();
  } catch (e) {
    err.textContent = 'Ошибка: ' + e.message;
  }
};

// ===== 4. Запуск после входа =====
async function start() {
  const { data } = await db.auth.getUser();
  if (!data.user) { showScreen('auth'); return; }

  const { data: profile } = await db.from('profiles')
    .select('*').eq('id', data.user.id).single();

  if (!profile) {
    await db.auth.signOut();
    showScreen('auth');
    $('auth-error').textContent = 'Профиль не найден. Зарегистрируйся заново';
    return;
  }

  me = profile;
  $('profile-name').textContent = me.name;
  $('profile-username').textContent = '@' + me.username;
  $('profile-avatar').textContent = me.name[0].toUpperCase();
  showScreen('main');
  loadChats();
}

$('logout-btn').onclick = async () => {
  await db.auth.signOut();
  location.reload();
};

// ===== 5. Нижнее меню =====
document.querySelectorAll('.bottom-nav button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.bottom-nav button')
      .forEach(b => b.classList.toggle('active', b === btn));
    ['chats', 'calls', 'profile'].forEach(t =>
      $('tab-' + t).classList.toggle('hidden', t !== btn.dataset.tab));
    $('main-title').textContent = btn.textContent;
  };
});

// ===== 6. Список чатов и поиск =====
function renderItem(p, subtitle) {
  const div = document.createElement('div');
  div.className = 'chat-item';
  div.innerHTML = '<div class="avatar"></div><div><b></b><div class="hint"></div></div>';
  div.querySelector('.avatar').textContent = p.name[0].toUpperCase();
  div.querySelector('b').textContent = p.name;
  div.querySelector('.hint').textContent = subtitle;
  div.onclick = () => openChat(p);
  return div;
}

async function loadChats() {
  const { data: msgs } = await db.from('messages').select('*')
    .or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`)
    .order('created_at', { ascending: false });

  const last = {}; // последнее сообщение с каждым человеком
  (msgs || []).forEach(m => {
    const other = m.sender_id === me.id ? m.receiver_id : m.sender_id;
    if (!last[other]) last[other] = m;
  });

  const ids = Object.keys(last);
  const list = $('chat-list');
  list.innerHTML = '';
  if (!ids.length) {
    list.innerHTML = '<p class="empty">Пока нет чатов. Найди человека по @нику</p>';
    return;
  }
  const { data: people } = await db.from('profiles').select('*').in('id', ids);
  people.sort((a, b) =>
    new Date(last[b.id].created_at) - new Date(last[a.id].created_at));
  people.forEach(p => list.appendChild(renderItem(p, last[p.id].text)));
}

$('search').oninput = async e => {
  const q = e.target.value.trim().toLowerCase().replace('@', '');
  if (!q) { loadChats(); return; }
  const { data } = await db.from('profiles').select('*')
    .ilike('username', `%${q}%`).neq('id', me.id).limit(20);
  const list = $('chat-list');
  list.innerHTML = '';
  if (!data || !data.length) {
    list.innerHTML = '<p class="empty">Никого не нашли</p>'; return;
  }
  data.forEach(p => list.appendChild(renderItem(p, '@' + p.username)));
};

// ===== 7. Открытие чата (заглушка, сделаем в части 3) =====
function openChat(p) {
  alert('Чат с ' + p.name + ' сделаем в следующей части');
}

// ===== 8. Старт при открытии страницы =====
start();
