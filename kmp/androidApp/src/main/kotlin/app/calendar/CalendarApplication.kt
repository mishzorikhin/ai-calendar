package app.calendar

import android.app.Application

class CalendarApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        initAndroid(this)
    }
}
