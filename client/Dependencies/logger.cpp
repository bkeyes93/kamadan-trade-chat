#include "stdafx.h"
#include "logger.h"

#include <GWCA/GameContainers/Array.h>
#include <GWCA/Managers/ChatMgr.h>
#include <GWCA/Managers/GameThreadMgr.h>

#define CHAN_WARNING GW::Chat::CHANNEL_GWCA2
#define CHAN_INFO    GW::Chat::CHANNEL_EMOTE
#define CHAN_ERROR   GW::Chat::CHANNEL_GWCA3

namespace {
	FILE* logfile = nullptr;
}

// === Setup and cleanup ====
void Log::InitializeLog() {
#if _DEBUG
	logfile = stdout;
	AllocConsole();
	FILE* fh;
	freopen_s(&fh, "CONOUT$", "w", stdout);
	freopen_s(&fh, "CONOUT$", "w", stderr);
	SetConsoleTitle("GWTB++ Debug Console");
#else
	logfile = _wfreopen(Resources::GetPath(L"log.txt").c_str(), L"w", stdout);
#endif
}

void Log::InitializeChat() {
	GW::Chat::SetMessageColor(CHAN_WARNING, 0xFFFFFF44); // warning
	GW::Chat::SetMessageColor(CHAN_INFO, 0xFFFFFFFF); // info
	GW::Chat::SetMessageColor(CHAN_ERROR, 0xFFFF4444); // error
}

void Log::Terminate() {
#if _DEBUG
	FreeConsole();
#else
	if (logfile) {
		fflush(logfile);
		fclose(logfile);
	}
#endif
}

// === File/console logging ===
static void PrintTimestamp() {
	time_t rawtime;
	time(&rawtime);
	
	struct tm timeinfo;
	localtime_s(&timeinfo, &rawtime);

	char buffer[16];
	strftime(buffer, sizeof(buffer), "%H:%M:%S", &timeinfo);

	fprintf(logfile, "[%s] ", buffer);
}

void Log::Log(const char* msg, ...) {
	if (!logfile) return;
	PrintTimestamp();

	va_list args;
	va_start(args, msg);
	vfprintf(logfile, msg, args);
	va_end(args);
}

void Log::LogW(const wchar_t* msg, ...) {
	if (!logfile) return;
	PrintTimestamp();

	va_list args;
	va_start(args, msg);
	vfwprintf(logfile, msg, args);
	va_end(args);
}

// === Game chat logging ===
static void _vchatlog(GW::Chat::Channel chan, const char* format, va_list argv) {
	char buf1[256];
	vsprintf_s(buf1, format, argv);

	char buf2[256];
	snprintf(buf2, 256, "<c=#00ccff>GWToolbox++</c>: %s", buf1);
	GW::GameThread::Enqueue([chan, buf2]() {
		GW::Chat::WriteChat(chan, buf2);
		});
	

	const char* c = [](GW::Chat::Channel chan) -> const char* {
		switch (chan) {
		case CHAN_INFO: return "Info";
		case CHAN_WARNING: return "Warning";
		case CHAN_ERROR: return "Error";
		default: return "";
		}
	}(chan);
	Log::Log("[%s] %s\n", c, buf1);
}

void Log::Info(const char* format, ...) {
	va_list vl;
	va_start(vl, format);
	_vchatlog(CHAN_INFO, format, vl);
	va_end(vl);
}

void Log::Error(const char* format, ...) {
	va_list vl;
	va_start(vl, format);
	_vchatlog(CHAN_ERROR, format, vl);
	va_end(vl);
}

void Log::Warning(const char* format, ...) {
	va_list vl;
	va_start(vl, format);
	_vchatlog(CHAN_WARNING, format, vl);
	va_end(vl);
}
