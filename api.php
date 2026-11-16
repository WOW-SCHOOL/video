<?php
declare(strict_types=1);
require_once __DIR__.'/config.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Frame-Options: DENY');
ini_set('session.use_strict_mode', '1');
if (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
    ini_set('session.cookie_secure', '1');
}
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_samesite', 'Lax');
session_start();

function api_response(array $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}
function api_fail(string $message, int $code = 400): never { api_response(['ok'=>false,'error'=>$message], $code); }
function client_json(): array {
    $raw = file_get_contents('php://input', false, null, 0, 30000);
    $data = json_decode((string)$raw, true);
    if (!is_array($data)) api_fail('Некорректный запрос.');
    return $data;
}
function storage_path(): string {
    // No web-accessible storage; public_html and temporary folders stay separate.
    $root = sys_get_temp_dir().'/wow_school_demo_'.substr(hash('sha256', __DIR__), 0, 16);
    if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) {
        api_fail('Сервер не может создать хранилище. Нужна запись в системную временную папку.', 500);
    }
    return $root.'/room.json';
}
function initial_room(): array {
    return [
        'slide'=>0, 'mode'=>'p2p', 'answers'=>[], 'manual'=>[], 'presence'=>[],
        'signals'=>[], 'seq'=>0, 'updated'=>time(),
    ];
}
function with_room(callable $fn): mixed {
    $path=storage_path();
    $fp=@fopen($path, 'c+');
    if (!$fp) api_fail('Не удалось открыть серверное хранилище.', 500);
    if (!flock($fp, LOCK_EX)) { fclose($fp); api_fail('Ошибка блокировки данных.', 500); }
    rewind($fp);
    $raw=stream_get_contents($fp);
    $state=json_decode($raw ?: '', true);
    if (!is_array($state)) $state=initial_room();
    if (time() - (int)($state['updated'] ?? 0) > 7*24*3600) $state=initial_room();
    $result=$fn($state);
    $state['updated']=time();
    rewind($fp);
    ftruncate($fp,0);
    fwrite($fp,json_encode($state, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE));
    fflush($fp);
    flock($fp,LOCK_UN);
    fclose($fp);
    return $result;
}
function check_csrf(array $req): void {
    $token=$req['csrf'] ?? '';
    if (!is_string($token) || !hash_equals((string)($_SESSION['csrf'] ?? ''),$token)) api_fail('Сессия устарела — обнови страницу.',419);
}
function validate_answer(int $index, mixed $value): mixed {
    $questions=classroom_questions();
    if (!isset($questions[$index])) api_fail('Нет такого задания.');
    $q=$questions[$index];
    if ($q['type']==='choice' || $q['type']==='listening') {
        if (!is_string($value) || !in_array($value,$q['options'],true)) api_fail('Выбери один из ответов.');
        return $value;
    }
    if ($q['type']==='fill' || $q['type']==='writing') {
        if (!is_string($value) || strlen($value)>3000) api_fail('Ответ слишком длинный.');
        return trim($value);
    }
    if ($q['type']==='order') {
        $ids=array_column($q['tokens'],'id');
        if (!is_array($value) || count($value)>count($ids) || count($value)!==count(array_unique($value)) || array_diff($value,$ids)) api_fail('Некорректный порядок слов.');
        return array_values($value);
    }
    if ($q['type']==='match') {
        if (!is_array($value) || count($value)>count($q['left'])) api_fail('Некорректные пары.');
        foreach ($value as $left=>$right) {
            if (!is_string($left) || !in_array($left,$q['left'],true) || !is_string($right) || !in_array($right,$q['right'],true)) api_fail('Некорректные пары.');
        }
        if (count($value)!==count(array_unique(array_values($value)))) api_fail('Один перевод нельзя использовать дважды.');
        return $value;
    }
    api_fail('Неизвестное упражнение.');
}
function grade_answer(int $index,mixed $answer): ?bool {
    $q=classroom_questions()[$index];
    if ($q['type']==='writing') return null;
    if ($q['type']==='fill') return strtolower(trim((string)$answer)) === $q['correct'];
    if ($q['type']==='match') {
        if (count($answer)!==count($q['correct'])) return false;
        foreach ($q['correct'] as $key=>$value) if (($answer[$key] ?? null)!==$value) return false;
        return true;
    }
    return $answer === $q['correct'];
}
$req=client_json();
$action=$req['action'] ?? '';
if ($action==='login') {
    $name=(string)($req['username']??'');
    $password=(string)($req['password']??'');
    if (!isset(DEMO_USERS[$name]) || !password_verify($password, DEMO_USERS[$name]['password_hash'])) {
        api_fail('Неверный логин или пароль.',401);
    }
    session_regenerate_id(true);
    $_SESSION['username']=$name;
    $_SESSION['csrf']=bin2hex(random_bytes(20));
    api_response(['ok'=>true,'csrf'=>$_SESSION['csrf'],'role'=>$name,'name'=>DEMO_USERS[$name]['label']]);
}
if (!isset($_SESSION['username']) || !isset(DEMO_USERS[$_SESSION['username']])) api_fail('Требуется вход в аккаунт.',401);
check_csrf($req);
$role=$_SESSION['username'];
$otherRole=$role==='teacher'?'student':'teacher';
if ($action==='logout') {
    $_SESSION=[]; session_destroy(); api_response(['ok'=>true]);
}
if ($action==='poll') {
    $uid=(string)($req['uid'] ?? '');
    if (!preg_match('/^[a-zA-Z0-9-]{8,60}$/',$uid)) api_fail('Некорректный идентификатор устройства.');
    $media=($req['media']??false)===true;
    $last=max(0,min(10000000,(int)($req['last']??0)));
    $result=with_room(static function (&$room) use ($role,$uid,$media,$last): array {
        $room['presence'][$role]=['uid'=>$uid,'media'=>$media,'at'=>time()];
        foreach ($room['presence'] as $r=>$p) {
            if (time()-(int)($p['at']??0)>10) unset($room['presence'][$r]);
        }
        $room['signals']=array_values(array_filter($room['signals'],static fn($v)=>time()-($v['at']??0)<120));
        $signals=array_values(array_filter($room['signals'],static fn($v)=>$v['id']>$last && $v['to']===$role && $v['toUid']===$uid));
        return ['slide'=>$room['slide'],'mode'=>$room['mode'],'answers'=>$room['answers'],
            'manual'=>$room['manual'],'presence'=>$room['presence'],
            'signals'=>$signals,'seq'=>$room['seq']];
    });
    api_response(['ok'=>true,'room'=>$result,'role'=>$role,'name'=>DEMO_USERS[$role]['label'],
        'questions'=>$role==='teacher'?classroom_questions():student_questions(),
        'jitsiRoom'=>JITSI_ROOM]);
}
if ($action==='signal') {
    $uid=(string)($req['uid']??'');
    $toUid=(string)($req['toUid']??'');
    $kind=(string)($req['kind']??'');
    $value=$req['value']??null;
    if (!preg_match('/^[a-zA-Z0-9-]{8,60}$/',$uid) || !preg_match('/^[a-zA-Z0-9-]{8,60}$/',$toUid)) api_fail('Неизвестный участник.');
    if (!in_array($kind,['offer','answer','candidate','bye'],true) || strlen(json_encode($value))>14000) api_fail('Неверный сигнал.');
    with_room(static function (&$room) use($role,$otherRole,$uid,$toUid,$kind,$value): void {
        if (($room['presence'][$role]['uid']??'')!==$uid || ($room['presence'][$otherRole]['uid']??'')!==$toUid) return;
        $room['seq']++;
        $room['signals'][]=['id'=>$room['seq'],'from'=>$role,'fromUid'=>$uid,'to'=>$otherRole,'toUid'=>$toUid,'kind'=>$kind,'value'=>$value,'at'=>time()];
        $room['signals']=array_slice($room['signals'],-300);
    });
    api_response(['ok'=>true]);
}
if ($action==='save_answer' || $action==='submit_answer') {
    if ($role!=='student') api_fail('Ответ может отправлять только ученик.',403);
    $index=(int)($req['index']??-1);
    $value=validate_answer($index,$req['value']??null);
    $submitted=$action==='submit_answer';
    with_room(static function (&$room) use($index,$value,$submitted):void {
        $room['answers'][(string)$index]=['value'=>$value,'submitted'=>$submitted,
            'grade'=>$submitted?grade_answer($index,$value):null,'at'=>time()];
    });
    api_response(['ok'=>true]);
}
if ($action==='navigate') {
    if ($role!=='teacher') api_fail('Переключать задания может преподаватель.',403);
    $slide=max(0,min(count(classroom_questions())-1,(int)($req['slide']??0)));
    with_room(static function (&$room) use($slide):void {$room['slide']=$slide;});
    api_response(['ok'=>true]);
}
if ($action==='set_mode') {
    if ($role!=='teacher') api_fail('Менять видеорежим может преподаватель.',403);
    $mode=$req['mode']??'';
    if (!in_array($mode,['p2p','jitsi'],true)) api_fail('Неподдерживаемый режим.');
    with_room(static function (&$room) use($mode):void {$room['mode']=$mode;});
    api_response(['ok'=>true]);
}
if ($action==='grade_writing') {
    if ($role!=='teacher') api_fail('Только преподаватель может проверять ответ.',403);
    $index=(int)($req['index']??-1);
    if ($index!==5) api_fail('Только открытый ответ проверяется вручную.');
    $grade=$req['grade']??null;
    if (!in_array($grade,['approved','redo'],true)) api_fail('Некорректная оценка.');
    with_room(static function (&$room) use($grade):void {$room['manual']['5']=$grade;});
    api_response(['ok'=>true]);
}
if ($action==='reset') {
    if ($role!=='teacher') api_fail('Сброс доступен преподавателю.',403);
    with_room(static function (&$room):void {$room['slide']=0;$room['answers']=[];$room['manual']=[];});
    api_response(['ok'=>true]);
}
api_fail('Неизвестная команда.',404);
