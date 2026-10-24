package seatapp.controller;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import seatapp.service.EventBus;

/** 全員の画面への即時の通知（SSE）。ログイン中の人だけが接続できる。 */
@RestController
public class EventsController {
    private final EventBus events;

    public EventsController(EventBus events) { this.events = events; }

    @GetMapping(value = "/api/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    SseEmitter events() { return events.subscribe(); }
}
