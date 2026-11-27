package com.patrickreynolds.focustracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

class WidgetTickerTest {
    @Test fun everyMinuteWithTheScreenOnLaterWithItOff() {
        assertEquals(60_000L, TickPlan.delayMs(screenOn = true))
        assertTrue(TickPlan.delayMs(screenOn = false) > TickPlan.delayMs(screenOn = true))
    }

    @Test fun exactWhenAllowedElseInexact() {
        assertEquals(TickPlan.Method.EXACT, TickPlan.method(30, false)) // Android 11: always allowed
        assertEquals(TickPlan.Method.EXACT, TickPlan.method(33, true))
        assertEquals(TickPlan.Method.INEXACT, TickPlan.method(31, false))
        assertEquals(TickPlan.Method.INEXACT, TickPlan.method(35, false))
    }

    @Test fun aSkippableRedrawIsDebounced() {
        var now = 1_000L
        val gate = RefreshGate({ now }, 20_000L)
        val runs = AtomicInteger()
        assertTrue(gate.run(false) { runs.incrementAndGet() })
        now += 5_000 // screen on, then unlocked
        assertFalse(gate.run(false) { runs.incrementAndGet() })
        now += 20_000
        assertTrue(gate.run(false) { runs.incrementAndGet() })
        assertEquals(2, runs.get())
    }

    @Test fun aRedrawTheAppAsksForIsNeverDebounced() {
        val gate = RefreshGate({ 0L }, 20_000L)
        assertTrue(gate.run(false) {})
        assertTrue(gate.run(true) {})
        assertTrue(gate.run(true) {})
    }

    @Test fun aSkippableRedrawIsSkippedWhileOneRuns() {
        val gate = RefreshGate({ 0L }, 0L)
        var inner = true
        gate.run(true) { inner = gate.run(false) {} }
        assertFalse(inner)
    }

    @Test fun aForcedRedrawWaitsForTheRunningOneNeverTwoAtOnce() {
        val gate = RefreshGate(System::currentTimeMillis, 0L)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val inFlight = AtomicInteger()
        val most = AtomicInteger()
        fun work(hold: () -> Unit = {}) { most.accumulateAndGet(inFlight.incrementAndGet(), ::maxOf); hold(); inFlight.decrementAndGet() }
        val first = thread { gate.run(false) { work { started.countDown(); release.await(5, TimeUnit.SECONDS) } } }
        started.await(5, TimeUnit.SECONDS)
        var ran = false
        val second = thread { ran = gate.run(true) { work() } }
        Thread.sleep(100)
        assertTrue(second.isAlive) // waiting
        release.countDown()
        first.join(5_000); second.join(5_000)
        assertTrue(ran)
        assertEquals(1, most.get())
    }
}
