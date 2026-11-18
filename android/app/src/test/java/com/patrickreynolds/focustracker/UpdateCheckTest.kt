package com.patrickreynolds.focustracker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckTest {
    private fun release(tag: String, body: String, vararg assets: String, draft: Boolean = false, pre: Boolean = false) =
        """{"tag_name":"$tag","draft":$draft,"prerelease":$pre,"body":${org.json.JSONObject.quote(body)},"assets":[${
            assets.joinToString(",") { """{"name":"$it","size":1234,"browser_download_url":"https://github.com/PatrickReynoldsCoding/focus-tracker-v2/releases/download/$tag/$it"}""" }
        }]}"""

    @Test fun picksTheNewestApkAndSkipsReleasesWithoutOne() {
        val json = "[" + listOf(
            release("v0.6.0", "Web only", ),
            release("v0.5.0", "Android 0.3.0\n\nversionCode: 3\n- tilt", "focus-tracker-0.3.0.apk"),
            release("v0.4.0", "old\nversionCode: 2", "focus-tracker-0.2.0.apk"),
        ).joinToString(",") + "]"
        val r = UpdateCheck.newestRelease(json)!!
        assertEquals("0.3.0", r.version)
        assertEquals(3, r.versionCode)
        assertEquals("focus-tracker-0.3.0.apk", r.apkName)
        assertTrue(r.apkUrl.endsWith("/v0.5.0/focus-tracker-0.3.0.apk"))
        assertFalse(r.notes.contains("versionCode"))
        assertTrue(r.notes.contains("- tilt"))
    }

    @Test fun ignoresDraftsPreReleasesAndOtherFiles() {
        val json = "[" + listOf(
            release("v0.9.0", "versionCode: 9", "focus-tracker-0.9.0.apk", draft = true),
            release("v0.8.0", "versionCode: 8", "focus-tracker-0.8.0.apk", pre = true),
            release("v0.7.0", "versionCode: 7", "notes.txt", "other-app-0.7.0.apk", "focus-tracker-0.7.0-debug.apk"),
        ).joinToString(",") + "]"
        assertNull(UpdateCheck.newestRelease(json))
        assertNull(UpdateCheck.newestRelease("[]"))
    }

    @Test fun versionCodeInTheNotesDecidesWhenPresent() {
        val r = Release("0.3.0", 3, "", "u", "focus-tracker-0.3.0.apk", 1)
        assertTrue(UpdateCheck.isNewerThanInstalled(r, 2, "0.2.0"))
        assertFalse(UpdateCheck.isNewerThanInstalled(r, 3, "0.2.0"))
        assertFalse(UpdateCheck.isNewerThanInstalled(r, 4, "0.1.0"))
    }

    @Test fun fallsBackToTheVersionNameWithoutACode() {
        val r = Release("0.3.0", null, "", "u", "focus-tracker-0.3.0.apk", 1)
        assertTrue(UpdateCheck.isNewerThanInstalled(r, 99, "0.2.9"))
        assertFalse(UpdateCheck.isNewerThanInstalled(r, 1, "0.3.0"))
    }

    @Test fun versionsAreComparedNumberByNumber() {
        assertTrue(UpdateCheck.isNewer("0.10.0", "0.9.2"))
        assertTrue(UpdateCheck.isNewer("1.0", "0.9.9"))
        assertFalse(UpdateCheck.isNewer("0.3.0", "0.3"))
        assertFalse(UpdateCheck.isNewer("0.2.9", "0.3.0"))
        assertFalse(UpdateCheck.isNewer("0.3.0-debug", "0.3.0"))
    }

    @Test fun codeLineAcceptsLooseSpelling() {
        val json = "[" + release("v1", "Notes\n  Version code = 12  \nmore", "focus-tracker-1.0.0.apk") + "]"
        assertEquals(12, UpdateCheck.newestRelease(json)!!.versionCode)
        assertNotNull(UpdateCheck.newestRelease("[" + release("v1", "no code here", "focus-tracker-1.0.0.apk") + "]"))
    }
}
