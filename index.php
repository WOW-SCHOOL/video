<?php
declare(strict_types=1);
ini_set('session.use_strict_mode', '1');
if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ini_set('session.cookie_secure', '1');
ini_set('session.cookie_httponly','1');
ini_set('session.cookie_samesite','Lax');
session_start();
require_once __DIR__.'/config.php';
if (!isset($_SESSION['csrf'])) $_SESSION['csrf']=bin2hex(random_bytes(20));
$logged = isset($_SESSION['username']) && isset(DEMO_USERS[$_SESSION['username']]);
$role=$logged?$_SESSION['username']:'';
?><!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#0c1430">
  <meta name="description" content="WOW SCHOOL — прототип интерактивного онлайн-класса с видеосвязью">
  <title>WOW SCHOOL — Live Classroom Demo</title>
  <link rel="stylesheet" href="style.css?v=1.0.0">
</head>
<body>
  <div class="top-glow" aria-hidden="true"></div>
  <header class="header">
    <div class="header-content">
      <a class="brand" href="./" aria-label="WOW SCHOOL — главная">
        <span class="brand-symbol">W<span>✦</span></span>
        <span class="brand-name">WOW<span>SCHOOL</span><small>LIVE CLASSROOM</small></span>
      </a>
      <div class="header-right">
        <span class="version"><span class="online-dot"></span> ДЕМО · V1.0</span>
        <div id="userChip" class="user-chip" hidden><span id="userAvatar" class="avatar-mini">У</span><span id="userName"></span></div>
        <button class="plain-icon" id="logoutBtn" type="button" title="Выйти из аккаунта" hidden>↪ <span>Выйти</span></button>
      </div>
    </div>
  </header>

  <main id="loginView" class="login-view" <?php if($logged) echo 'hidden'; ?>>
    <div class="login-showcase">
      <div class="pill-glow">✦ НАША БУДУЩАЯ ПЛАТФОРМА</div>
      <h1>Английский.<br><em>В одном пространстве.</em></h1>
      <p>Прототип урока с видеосвязью, интерактивными упражнениями и синхронизацией ответов в реальном времени.</p>
      <div class="feature-list">
        <span>⚡ Живые задания</span><span>📹 Своя видеокомната</span><span>🔄 Два устройства</span>
      </div>
      <div class="lesson-illustration" aria-hidden="true">
        <div class="illus-head"><span class="illus-live">● LIVE LESSON</span><span>Unit 01 / A1</span></div>
        <div class="illus-card"><div class="illus-heading">She ___ to school every day.</div><div class="illus-answers"><span>go</span><span class="illus-selected">✓ goes</span><span>going</span></div></div>
        <div class="illus-pips"><span></span><span></span><span></span><span></span><span></span></div>
      </div>
    </div>
    <div class="login-card glass-card">
      <div class="login-card-badge">👋 РАДЫ ВИДЕТЬ ВАС</div>
      <h2>Вход в демо-класс</h2>
      <p class="muted">Выбери роль. Для теста уже подготовлены две учётные записи.</p>
      <div class="role-picker" role="group" aria-label="Выбери роль">
        <button type="button" class="role-option active" data-role="teacher"><span class="role-emoji">👩🏻‍🏫</span><strong>Преподаватель</strong><small>Управляет уроком</small></button>
        <button type="button" class="role-option" data-role="student"><span class="role-emoji">🎒</span><strong>Ученик</strong><small>Решает задания</small></button>
      </div>
      <form id="loginForm" autocomplete="off">
        <label for="loginName">Логин</label>
        <input id="loginName" name="username" type="text" value="teacher" autocomplete="username" required>
        <label for="loginPassword">Пароль</label>
        <input id="loginPassword" name="password" type="password" value="teacher123" autocomplete="off" required>
        <button class="primary-btn full-width" type="submit" id="loginBtn">Войти в класс <span>↗</span></button>
      </form>
      <p class="error-box" id="loginError" hidden></p>
      <div class="login-foot">🔒 Тестовые аккаунты. Реальные данные и платежи не используются.</div>
    </div>
  </main>

  <main id="appView" class="app-view" <?php if(!$logged) echo 'hidden'; ?>>
    <section class="welcome-area">
      <div class="welcome-left">
        <div class="breadcrumb">МОЙ КЛАСС <span>›</span> АНГЛИЙСКИЙ ЯЗЫК <span>›</span> UNIT 01</div>
        <h1>Present Simple <span class="highlight-mark">✳</span></h1>
        <p>Практика на каждый день. Учимся понимать, говорить и строить предложения.</p>
      </div>
      <div class="stats-top">
        <div class="stat-block"><strong id="progressTop">0 <small>/ 6</small></strong><span>Выполнено</span></div>
        <div class="stat-divider"></div>
        <div class="stat-block"><strong id="participantTop">1 <small>/ 2</small></strong><span>В классе</span></div>
      </div>
    </section>

    <section class="classroom-grid">
      <div class="lesson-column">
        <div class="lesson-card glass-card">
          <div class="lesson-card-top">
            <span class="section-eyebrow">📚 ИНТЕРАКТИВНЫЙ УРОК</span>
            <span class="slide-counter" id="slideCounter">Задание 01 / 06</span>
          </div>
          <div class="progress-track"><span id="progressTrack"></span></div>
          <div class="lesson-tabs" id="lessonTabs"></div>
          <div id="exerciseContent" class="exercise-content"><div class="skeleton">Подключаем урок...</div></div>
          <div class="lesson-footer">
            <div id="lessonHint" class="lesson-hint">🔄 Ответы ученика синхронизируются с преподавателем.</div>
            <div class="lesson-footer-buttons" id="lessonActions"></div>
          </div>
        </div>
        <div class="bottom-grid">
          <div class="sub-card glass-card">
            <div class="sub-card-title">✦ Как это работает</div>
            <p>Открой этот сайт на телефоне и компьютере. Войди под разными ролями — увидишь один урок, ответы и общую видеокомнату.</p>
          </div>
          <div class="sub-card glass-card">
            <div class="sub-card-title">🧩 Общий прогресс</div>
            <div class="completion-grid" id="completionGrid"></div>
            <p id="completionText" class="tiny-muted">Упражнения ещё не выполнены.</p>
          </div>
        </div>
      </div>
      <aside class="sidebar-column">
        <div class="video-card glass-card">
          <div class="sidebar-card-head"><div><strong>Видеокласс</strong><small>Ученик + преподаватель</small></div><span class="call-indicator" id="callIndicator">НЕ В СЕТИ</span></div>
          <div class="video-stage" id="videoStage">
            <div id="remotePlaceholder" class="remote-placeholder"><span class="video-big-icon">📹</span><strong>Видеосвязь готова</strong><small>Включи камеру и микрофон, чтобы начать звонок</small></div>
            <video id="remoteVideo" autoplay playsinline hidden></video>
            <div class="local-preview" id="localPreview" hidden><video id="localVideo" muted autoplay playsinline></video><div class="self-label">Вы</div></div>
            <div id="jitsiContainer" hidden></div>
          </div>
          <div class="media-controls" id="mediaControls">
            <button type="button" id="startMedia" class="primary-btn full-width"><span>📹</span> Включить видеосвязь</button>
            <button type="button" id="stopMedia" class="danger-outline-btn full-width" hidden>■ Завершить звонок</button>
          </div>
          <div class="media-status" id="mediaStatus" aria-live="polite">Для работы камеры требуется HTTPS.</div>
          <a id="jitsiOpen" href="#" target="_blank" rel="noopener noreferrer" class="jitsi-external" hidden>↗ Если окно не открывается — подключиться в отдельной вкладке</a>
          <div class="mode-box">
            <div class="mode-label"><strong>Способ подключения</strong><span id="modeLabel">WebRTC P2P</span></div>
            <div class="mode-buttons" id="modeButtons" hidden><button id="p2pModeBtn" class="mode-btn selected" type="button">Напрямую</button><button id="jitsiModeBtn" class="mode-btn" type="button">Резерв Jitsi</button></div>
            <p>Прямое соединение бесплатно. В некоторых сетях потребуется резервная связь или TURN-сервер.</p>
          </div>
          <div class="video-safety">🛡️ Видеозапись и расшифровка в демо не ведутся.</div>
        </div>
        <div class="members-card glass-card">
          <div class="sidebar-card-head"><div><strong>Участники класса</strong><small>Обновляются автоматически</small></div><span class="people-icon">👥</span></div>
          <div class="member" id="teacherMember"><div class="member-avatar teacher-avatar">А</div><div><strong>Александр</strong><small>Преподаватель</small></div><span class="member-status">○</span></div>
          <div class="member" id="studentMember"><div class="member-avatar student-avatar">М</div><div><strong>Мария</strong><small>Ученик</small></div><span class="member-status">○</span></div>
        </div>
        <div class="teacher-card glass-card" id="teacherTools" hidden>
          <div class="sub-card-title">⚙️ Для преподавателя</div>
          <p>Ты видишь ключи к заданиям, ответы ученика и управляешь переходами.</p>
          <button type="button" id="resetLesson" class="text-button">↺ Сбросить результаты урока</button>
        </div>
      </aside>
    </section>
    <footer class="footer">WOW SCHOOL · Тестовая версия интерактивного класса <span>Не использовать с настоящими учениками или персональными данными</span></footer>
  </main>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <script>window.WOW_BOOT={csrf:<?=json_encode($_SESSION['csrf'])?>,logged:<?=$logged?'true':'false'?>,role:<?=json_encode($role)?>};</script>
  <script src="app.js?v=1.0.0" defer></script>
</body>
</html>
