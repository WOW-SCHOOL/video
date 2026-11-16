<?php
declare(strict_types=1);

// WOW SCHOOL classroom demo. Credentials are DEMONSTRATION ONLY; change before public use.
const DEMO_USERS = [
    'teacher' => [
        'label' => 'Александр', 'role' => 'teacher',
        'password_hash' => '$2y$12$nkZWHoykRH0qClVG/.Zxcu2rCxsyYrNRbzKMT/mlzU2YRmUzgUbZK',
    ],
    'student' => [
        'label' => 'Мария', 'role' => 'student',
        'password_hash' => '$2y$12$Sj9KclRUGeAsWm.a018lAOGRZHz54v7gW6q0bQ0SYfqHZSfvBPQwq',
    ],
];
// Unique room name for Jitsi fallback (not a secret authorization mechanism).
const JITSI_ROOM = 'WOWClassDemo-7fe28c5bb3436fb42dfdc5d9dcb1cf38';

function classroom_questions(): array {
    return [
        [
            'id' => 'q1', 'type' => 'choice', 'tag' => 'GRAMMAR', 'title' => 'Выбери правильный ответ',
            'prompt' => 'She ___ to school every day.',
            'description' => 'Вспомни, что происходит с глаголом после he / she / it.',
            'options' => ['go', 'goes', 'going', 'is go'], 'correct' => 'goes',
            'hint' => 'В Present Simple к глаголу после she обычно добавляется -s.',
        ],
        [
            'id' => 'q2', 'type' => 'fill', 'tag' => 'VOCABULARY', 'title' => 'Вставь пропущенное слово',
            'prompt' => 'I ___ coffee every morning.',
            'description' => 'Напиши один глагол: пить — на английском.',
            'placeholder' => 'Напиши слово на английском', 'correct' => 'drink',
            'hint' => 'Первая буква — d.',
        ],
        [
            'id' => 'q3', 'type' => 'match', 'tag' => 'MATCHING', 'title' => 'Найди пары',
            'prompt' => 'Соедини английские слова с переводом.',
            'description' => 'Нажми на английское слово, затем на его русский перевод.',
            'left' => ['read','speak','learn','sleep'],
            'right' => ['спать','учить','читать','говорить'],
            'correct' => ['read'=>'читать','speak'=>'говорить','learn'=>'учить','sleep'=>'спать'],
            'hint' => 'Каждая пара образуется из глагола и его перевода.',
        ],
        [
            'id' => 'q4', 'type' => 'order', 'tag' => 'WORD ORDER', 'title' => 'Собери предложение',
            'prompt' => 'Поставь слова в правильном порядке.',
            'description' => 'Нажимай на слова по очереди. Чтобы убрать слово — нажми на него в ответе.',
            'tokens' => [
                ['id'=>'a','text'=>'at seven.'],
                ['id'=>'b','text'=>'usually'],
                ['id'=>'c','text'=>'I'],
                ['id'=>'d','text'=>'get up'],
            ],
            'correct' => ['c','b','d','a'],
            'hint' => 'Начни с подлежащего I.',
        ],
        [
            'id' => 'q5', 'type' => 'listening', 'tag' => 'LISTENING', 'title' => 'Послушай и ответь',
            'prompt' => 'What is his job?',
            'description' => 'Нажми «Прослушать», затем выбери профессию.',
            'audioText' => 'My brother works in a hospital. He helps sick people. He is a doctor.',
            'options' => ['teacher','doctor','driver','chef'],
            'correct' => 'doctor',
            'hint' => 'He works in a hospital.',
        ],
        [
            'id' => 'q6', 'type' => 'writing', 'tag' => 'SPEAKING & WRITING', 'title' => 'Расскажи о себе',
            'prompt' => 'What do you usually do in the morning?',
            'description' => 'Напиши 2–3 предложения. Преподаватель обсудит их с тобой.',
            'placeholder' => 'Every morning I ...',
            'correct' => null,
            'hint' => 'Используй usually, every morning, then.',
        ],
    ];
}

function student_questions(): array {
    return array_map(static function(array $q): array {
        unset($q['correct'], $q['hint']);
        return $q;
    }, classroom_questions());
}
