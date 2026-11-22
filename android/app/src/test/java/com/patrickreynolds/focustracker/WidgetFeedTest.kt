package com.patrickreynolds.focustracker

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class WidgetFeedTest {
    // Shape of GET /api/widget/files (src/modules/widgets.ts).
    private val files = """{"mode":"personal","source":{"by":"folder","id":"f1","name":"Shelf"},"missing":false,"more":false,
      "files":[{"kind":"note","id":"n1","title":"Ideas","project_id":null,"project":null,"updated_at":"x","route":"/n/n1","text":"Ideas\n\nA long…","more":true},
               {"kind":"todo","id":"t1","title":"Jobs","project_id":"p1","project":"Kitchen","updated_at":"x","route":"/n/t1","text":"☐ Sand","open":1,
                "items":[{"id":"c1","title":"Sand","done":false}],"more":false},
               {"kind":"link","id":"r1","title":"Supplier","project_id":null,"project":null,"updated_at":"x","route":null,"url":"https://example.com","text":"https://example.com","more":false}]}"""

    @Test fun parsesTheFilesFeed() {
        val f = FilesFeed.parse(JSONObject(files))
        assertEquals("Shelf", f.sourceName)
        assertEquals(3, f.files.size)
        assertEquals("/n/n1", f.files[0].route)
        assertTrue(f.files[0].more)
        assertEquals(null, f.files[0].items)
        assertEquals("Kitchen", f.files[1].project)
        assertEquals(listOf(WidgetFile.Item("c1", "Sand", false)), f.files[1].items)
        assertEquals(null, f.files[2].route)
        assertEquals("https://example.com", f.files[2].url)
    }

    @Test fun rowsOfOneFile() {
        val f = FilesFeed.parse(JSONObject(files))
        val note = FileRows.of(f.files[0])
        assertEquals(listOf("Ideas", "A long…", "More in the app…"), note.map { it.text })
        val todo = FileRows.of(f.files[1].copy(items = listOf(WidgetFile.Item("c1", "Sand", false), WidgetFile.Item("c2", "Paint", true))))
        assertEquals(listOf("☐", "☑"), todo.map { it.mark })
        assertEquals(listOf("c1", "c2"), todo.map { it.itemId })
    }

    @Test fun buildsTheRequests() {
        val c = WidgetConfig(mode = "work", source = "folder", sourceId = "f 1", deep = false, others = true, unit = WidgetConfig.UNIT_LINES, max = 3, sort = "name")
        assertEquals("/api/widget/files?limit=30&lines=3&max=1000&sort=name&kinds=default,others&folder=f%201&deep=0", c.filesPath())
        assertEquals("/files/f 1", c.sourceRoute())
        val t = WidgetConfig(mode = "personal", source = "tag", sourceId = "g1", max = 150)
        assertEquals("/api/widget/files?limit=30&max=150&sort=changed&tag=g1", t.filesPath())
        assertEquals("/files?tag=g1", t.sourceRoute())
        assertEquals("/api/widget/files?limit=30&max=200&sort=changed", WidgetConfig(mode = "x").filesPath())
        val one = WidgetConfig(mode = "x", fileKind = "project-note", fileId = "p1", unit = WidgetConfig.UNIT_LINES, max = 10)
        assertEquals("/api/widget/file/project-note/p1?lines=10&max=4000", one.filePath())
        // Kept and read back the same.
        assertEquals(c, WidgetConfig.parse(c.toJson()))
    }

    @Test fun widthsDownToTwoCells() {
        assertEquals(WidgetSizes.Width.NARROW, WidgetSizes.widthOf(110))
        assertEquals(WidgetSizes.Width.NARROW, WidgetSizes.widthOf(180))
        assertEquals(WidgetSizes.Width.COMPACT, WidgetSizes.widthOf(220))
        assertEquals(WidgetSizes.Width.WIDE, WidgetSizes.widthOf(300))
        assertEquals(WidgetSizes.Width.WIDE, WidgetSizes.widthOf(0))
    }

    /** Every widget can be placed and resized down to 2 cells wide (the owner's ask for 0.4.0). */
    @Test fun everyWidgetGoesDownToTwoCells() {
        val dir = listOf(File("src/main/res/xml"), File("app/src/main/res/xml")).first { it.isDirectory }
        val infos = dir.listFiles { f -> f.name.endsWith("_widget_info.xml") }!!.sortedBy { it.name }
        assertEquals(listOf("file_widget_info.xml", "files_widget_info.xml", "today_widget_info.xml"), infos.map { it.name })
        for (f in infos) {
            val x = f.readText()
            fun dp(attr: String) = Regex("android:$attr=\"(\\d+)dp\"").find(x)!!.groupValues[1].toInt()
            assertTrue("${f.name} minWidth", dp("minWidth") <= 110)
            assertTrue("${f.name} minResizeWidth", dp("minResizeWidth") <= 110)
            assertTrue("${f.name} targetCellWidth", x.contains("android:targetCellWidth=\"2\""))
            assertTrue("${f.name} resizes", x.contains("horizontal"))
        }
        // The narrow layouts the 2-cell size uses exist and keep the ids the code sets.
        val layouts = File(dir.parentFile, "layout")
        val narrow = File(layouts, "widget_today_narrow.xml").readText()
        for (id in listOf("background", "header", "focus", "next", "add", "session_row", "timer", "pomodoro", "action", "list", "empty")) assertTrue(id, narrow.contains("id/$id\""))
        for (name in listOf("widget_item.xml", "widget_item_narrow.xml")) {
            val item = File(layouts, name).readText()
            for (id in listOf("row", "mark", "title", "detail", "skip")) assertTrue("$name $id", item.contains("id/$id\""))
        }
    }
}
