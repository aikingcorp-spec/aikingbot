import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

// Not translated yet: the screen shows the English text.
export const messages = {
  "status.messaging.working": "Уже работаю…",
  "status.messaging.queued": "Ожидание: AIKINGBOT занят другим запросом. Ответ придёт сюда.",
  "status.messaging.busy": "В очереди слишком много запросов. Повторите позже.",
  "status.messaging.failed": "AIKINGBOT не смог завершить этот запрос. Подробности — на хосте AIKINGBOT.",
  "status.messaging.noAnswer": "AIKINGBOT завершил работу без письменного ответа.",
  "status.messaging.noAgent": "Пока нет агента, который мог бы здесь ответить. Добавьте Оркестратор Slack в AIKINGBOT.",
  "status.messaging.delegated": "Над этим работает один из помощников. Ответ придёт сюда.",
  "status.messaging.stopped": "Остановлено.",
  "status.messaging.stop": "Остановить",
  "status.messaging.approvalTitle": "AIKINGBOT просит подтверждение, чтобы продолжить.",
  "status.messaging.approvalCommand": "Выполнить команду",
  "status.messaging.approvalFileChange": "Изменить файлы",
  "status.messaging.approvalPermissions": "Получить дополнительные разрешения",
  "status.messaging.approve": "Одобрить",
  "status.messaging.deny": "Отклонить",
  "status.messaging.approvedBy": "Одобрено: {user}.",
  "status.messaging.deniedBy": "Отклонено: {user}.",
  "status.messaging.answeredOnHost": "Отвечено на хосте AIKINGBOT.",
  "status.messaging.requestInactive": "Этот запрос больше не активен.",
  "status.messaging.onlyRequester": "Это может сделать только {user}. Ответить также может хост AIKINGBOT.",
  "status.messaging.hostOnly": "На этот запрос может ответить только хост AIKINGBOT.",
  "status.messaging.filesSkipped": "Некоторые файлы не отправлены: {names}.",
  "status.messaging.orchestratorName": "Оркестратор Slack",
  "status.messaging.orchestratorTitle": "Отвечает в Slack и обращается к команде",
  "status.messaging.discordNoAgent":
    "Пока нет агента, который мог бы здесь ответить. Добавьте Оркестратор Discord в AIKINGBOT.",
  "status.messaging.discordOrchestratorName": "Оркестратор Discord",
  "status.messaging.discordOrchestratorTitle": "Отвечает в Discord и обращается к команде",
  "status.messaging.integrationsSection": "Интеграции",
  "status.messaging.signInReceived": "AIKINGBOT получил установку Slack. Эту вкладку можно закрыть.",
  "status.messaging.signInUnknown": "AIKINGBOT не начинал эту установку Slack. Начните её заново в AIKINGBOT.",
  "status.messaging.telegramNoAgent": "Здесь пока никто не может ответить. Добавьте Оркестратора Telegram в AIKINGBOT.",
  "status.messaging.telegramLinked":
    "AIKINGBOT подключён к этому чату. Упомяните {bot} или ответьте на сообщение AIKINGBOT, чтобы обратиться к агентам.",
  "status.messaging.telegramOrchestratorName": "Оркестратор Telegram",
  "status.messaging.telegramOrchestratorTitle": "Отвечает в Telegram и обращается к команде",
} as const satisfies PartialTranslation<typeof source>;
