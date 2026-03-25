local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrHttp = import 'LrHttp'
local LrView = import 'LrView'
local LrDialogs = import 'LrDialogs' -- Added for popup debugging

local exportFilterProvider = {}

exportFilterProvider.exportPresetFields = {
    { key = 'enabled', default = true }
}

function exportFilterProvider.sectionForFilterInDialog( f, propertyTable )
    return {
        title = "Social Media Central",
        f:row {
            f:static_text {
                title = "Images and metadata will be sent to the SMC app after export."
            }
        }
    }
end

function exportFilterProvider.postProcessRenderedPhotos(functionContext, filterContext)
    local exportSession = filterContext.exportSession
    local imagePaths = {}
    local metadata = {}
    local firstPhotoProcessed = false

    for i, rendition in exportSession:renditions() do
        local success, pathOrMessage = rendition:waitForRender()
        
        if success then
            table.insert(imagePaths, pathOrMessage)

            if not firstPhotoProcessed then
                local photo = rendition.photo
                metadata = {
                    title = photo:getFormattedMetadata('title') or "",
                    caption = photo:getFormattedMetadata('caption') or "",
                    keywords = photo:getFormattedMetadata('keywordTagsForExport') or "",
                    location = photo:getFormattedMetadata('location') or "",
                    camera = photo:getFormattedMetadata('cameraModel') or "",
                    lens = photo:getFormattedMetadata('lens') or "",
                    aperture = photo:getFormattedMetadata('aperture') or "",
                    iso = photo:getFormattedMetadata('isoSpeedRating') or ""
                }
                firstPhotoProcessed = true
            end
        end
    end

    if #imagePaths > 0 then
        LrTasks.startAsyncTask(function()
            local function escapeJson(str)
                if str == nil then return "" end
                str = tostring(str)
                str = string.gsub(str, "\\", "\\\\")
                str = string.gsub(str, '"', '\\"')
                str = string.gsub(str, "\n", "\\n")
                str = string.gsub(str, "\r", "\\r")
                return str
            end

            local keywordsJson = "[]"
            if metadata.keywords ~= "" then
                local kwArray = {}
                for kw in string.gmatch(metadata.keywords, "[^,]+") do
                    kw = string.match(kw, "^%s*(.-)%s*$")
                    table.insert(kwArray, '"' .. escapeJson(kw) .. '"')
                end
                keywordsJson = "[" .. table.concat(kwArray, ", ") .. "]"
            end

            local pathsJsonArray = {}
            for _, p in ipairs(imagePaths) do
                table.insert(pathsJsonArray, '"' .. escapeJson(p) .. '"')
            end
            local pathsJson = "[" .. table.concat(pathsJsonArray, ", ") .. "]"

            local payload = string.format([[
            {
                "imagePaths": %s,
                "metadata": {
                    "title": "%s",
                    "caption": "%s",
                    "keywords": %s,
                    "location": "%s",
                    "camera": "%s",
                    "lens": "%s",
                    "aperture": "%s",
                    "iso": "%s"
                }
            }
            ]], 
            pathsJson, 
            escapeJson(metadata.title), 
            escapeJson(metadata.caption), 
            keywordsJson,
            escapeJson(metadata.location), 
            escapeJson(metadata.camera), 
            escapeJson(metadata.lens), 
            escapeJson(metadata.aperture), 
            escapeJson(metadata.iso))

            local headers = {
                { field = 'Content-Type', value = 'application/json' }
            }

            -- Send the data and capture the response!
            local response, responseHeaders = LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
            
            if response then
                LrDialogs.message("SMC Server Response", tostring(response), "info")
            else
                LrDialogs.message("Connection Failed", "Could not reach Social Media Central. Is the app open?", "critical")
            end
        end)
    end
end

return exportFilterProvider
